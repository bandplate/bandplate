// Every stem of one take, running together, so a member can play along with
// the band minus their own part.
//
// THE ENGINE, and why it is this one. Decoding every stem to an `AudioBuffer`
// — the way you get sample-locked playback and gapless loops — costs ~170MB
// per stem for an eight-minute take, so about a gigabyte for one take. That
// is not a mobile problem, it is a tab-death problem. So each track is a
// streaming `<audio>` through a `MediaElementAudioSourceNode` into its own
// `GainNode`, and mute, solo and volume are exact and free.
//
// `/dev/sync` measured what that costs in sync before any of this was
// written: on Chrome, zero ppm over five minutes, a 2.9ms spread that never
// grew. See `mixer-sync.ts` for why there is no servo here.
//
// Every decision lives in a pure module a node-only vitest can reach —
// `mixer-tracks.ts` for gains, `mixer-sync.ts` for alignment. What is left
// here is Web Audio calls and the lifecycle, which is the part no test in
// this repo can run.
import { type Locale, mixerMessages } from "@bandplate/i18n";
import { trackColorVar } from "@bandplate/ui/tokens/track-colors.js";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";
import { type LanePeaks, mixerLaneBars } from "../client/mixer-peaks.js";
import {
  DEFAULT_SYNC_TUNING,
  INITIAL_SYNC_STATE,
  type SyncState,
  type TrackSample,
  decideSync,
  resetSyncState,
} from "../client/mixer-sync.js";
import { timelineTicks } from "../client/mixer-ticks.js";
import {
  type MixerState,
  initialMixerState,
  setFader,
  setMuted,
  setSoloed,
  toggleMuteMine,
  trackGains,
} from "../client/mixer-tracks.js";

export interface MixerTrackProps {
  assetId: string;
  kind: "master" | "stem";
  label: string;
  color: string | null;
  mine: boolean;
}

export interface MixerProps {
  takeId: string;
  tracks: MixerTrackProps[];
  canMuteMine: boolean;
  onlyInMaster: string[];
  /** SSR fallback only — `<html lang>` wins in the browser. See `client/locale.ts`. */
  locale?: Locale;
}

/** How often alignment is checked. A timer, not rAF: rAF stops dead in a background tab. */
const SYNC_INTERVAL_MS = 250;

/** Mutes and un-mutes ramp rather than jump, or every press is a click. */
const GAIN_RAMP_S = 0.015;

/** Give up waiting for a track to become playable. Long, because this is a cold start over the network. */
const START_TIMEOUT_MS = 20_000;

/** One bar per this many CSS pixels, matching the player's waveform. */
const BAR_PITCH_PX = 3;
const MIN_BARS = 40;
const MAX_BARS = 600;

type Phase = "idle" | "starting" | "playing" | "paused" | "failed";

/** mm:ss. Floored, because it is a running clock and rounding it up shows a second that has not happened. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function Mixer({ tracks, canMuteMine, onlyInMaster, locale }: MixerProps) {
  const t = mixerMessages(currentLocale(locale));

  const [mix, setMix] = useState<MixerState>(() => initialMixerState(tracks));
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<string>("");
  const [position, setPosition] = useState(0);
  const [lanes, setLanes] = useState<(number[] | null)[]>(() => tracks.map(() => null));
  const [bars, setBars] = useState(160);
  const [duration, setDuration] = useState(0);
  const lanesRef = useRef<HTMLDivElement | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const elementsRef = useRef<HTMLAudioElement[]>([]);
  const gainsRef = useRef<GainNode[]>([]);
  const wiredRef = useRef<boolean[]>([]);
  const syncRef = useRef<SyncState>(INITIAL_SYNC_STATE);
  // The live mix, for the sync loop and the gain effect to read without
  // either of them becoming a dependency that re-runs the other.
  const mixRef = useRef(mix);
  mixRef.current = mix;

  // --- graph ---------------------------------------------------------------

  const teardown = useCallback(() => {
    for (const el of elementsRef.current) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    elementsRef.current = [];
    gainsRef.current = [];
    wiredRef.current = [];
    const ctx = ctxRef.current;
    ctxRef.current = null;
    masterRef.current = null;
    // Chrome caps simultaneous AudioContexts at around six, so leaking one per
    // visit bricks the page after a handful of trips — which looks like a
    // browser bug rather than ours.
    if (ctx && ctx.state !== "closed") {
      void ctx.close();
    }
  }, []);

  useEffect(() => {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    // Seven stems sum to roughly the original master, so unity is right —
    // until three faders go up. Web Audio's destination hard-clips, which
    // sounds like destruction rather than loudness, so one compressor of
    // insurance sits in front of it.
    const guard = ctx.createDynamicsCompressor();
    guard.threshold.value = -1;
    guard.ratio.value = 20;
    master.connect(guard);
    guard.connect(ctx.destination);
    ctxRef.current = ctx;
    masterRef.current = master;

    const elements: HTMLAudioElement[] = [];
    const gains: GainNode[] = [];
    const wired: boolean[] = [];

    tracks.forEach((track, index) => {
      const el = new Audio();
      // Mandatory, and the single thing most likely to make this silently
      // produce nothing: the src is same-origin but 302s to the bucket, and
      // without this the response is opaque, the element is tainted, and
      // `createMediaElementSource` outputs silence with no error at all.
      el.crossOrigin = "anonymous";
      // Not `none` (the shell player's convention) and not `auto`. Metadata
      // means the duration is known before anyone presses anything and the
      // CORS handshake happens up front, so a misconfiguration surfaces as an
      // `error` event rather than as eight minutes of silence. `auto` would be
      // seven full downloads whether or not play is ever pressed, and iOS
      // downgrades it to metadata anyway.
      el.preload = "metadata";
      el.src = `/api/assets/${track.assetId}/audio`;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(master);

      // Lazily, on `loadedmetadata`, never at construction: Safari has
      // historically returned permanent silence for THAT ELEMENT ALONE when
      // the node was created before the element loaded — six of seven stems
      // still play, which is the worst kind of partial failure.
      el.addEventListener("loadedmetadata", () => {
        // The axis is the LONGEST track, never the first: a stem is allowed
        // to be shorter than the take. Read HERE as well as in the sync tick,
        // or the ruler has no scale and draws no ticks until someone presses
        // play — which is exactly when they are least useful.
        if (Number.isFinite(el.duration)) {
          setDuration((current) => Math.max(current, el.duration));
        }
        if (wired[index] || ctxRef.current !== ctx) {
          return;
        }
        wired[index] = true;
        ctx.createMediaElementSource(el).connect(gain);
      });
      el.addEventListener("error", () => {
        setFailure(t.trackFailed(track.label));
      });

      el.load();
      elements.push(el);
      gains.push(gain);
      wired.push(false);
    });

    elementsRef.current = elements;
    gainsRef.current = gains;
    wiredRef.current = wired;
    return teardown;
    // Built once for this take. `t` is read only inside handlers.
  }, [tracks, teardown, t.trackFailed]);

  // --- gains ---------------------------------------------------------------

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) {
      return;
    }
    const wanted = trackGains(mix.tracks);
    mix.tracks.forEach((track, index) => {
      const gain = gainsRef.current[index];
      if (!gain) {
        return;
      }
      // Ramped, not assigned: an instant gain change is a click.
      gain.gain.setTargetAtTime(wanted.get(track.assetId) ?? 0, ctx.currentTime, GAIN_RAMP_S);
    });
  }, [mix]);

  // --- transport -----------------------------------------------------------

  /**
   * Put every element on the same instant.
   *
   * Stop-the-world, never a compensated `currentTime = leader + guess`: the
   * seek latency is unknowable and wrong differently on every engine. Costs a
   * short hole in the audio, which is rare and beats a long detune.
   */
  const alignTo = useCallback(async (targetS: number) => {
    const elements = elementsRef.current;
    const master = masterRef.current;
    const ctx = ctxRef.current;
    if (!ctx || !master) {
      return;
    }
    master.gain.setTargetAtTime(0, ctx.currentTime, GAIN_RAMP_S);
    // The playhead moves HERE, not only from the sync loop. That loop runs
    // while playing, so leaving it to report the new position meant a seek
    // did nothing visible whenever the mixer was paused or had never been
    // started — which is most of the time someone spends clicking a timeline.
    setPosition(targetS);
    const wasPlaying = elements.some((el) => !el.paused);
    for (const el of elements) {
      el.pause();
      el.currentTime = targetS;
    }
    await Promise.all(
      elements.map(
        (el) =>
          new Promise<void>((resolve) => {
            if (el.seeking === false) {
              resolve();
              return;
            }
            const done = () => {
              el.removeEventListener("seeked", done);
              resolve();
            };
            el.addEventListener("seeked", done);
            setTimeout(done, 2000);
          }),
      ),
    );
    if (wasPlaying) {
      for (const el of elements) {
        void el.play().catch(() => undefined);
      }
    }
    syncRef.current = resetSyncState();
    master.gain.setTargetAtTime(1, ctx.currentTime, GAIN_RAMP_S);
  }, []);

  const start = useCallback(() => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    const elements = elementsRef.current;
    if (!ctx || !master || elements.length === 0) {
      return;
    }
    setFailure("");
    setPhase("starting");
    // Everything reachable from the gesture, synchronously. iOS unlocks per
    // element per document, and Safari loses the gesture across an `await` —
    // so no await, no fetch, no Promise.all before this loop.
    void ctx.resume();
    // Silently: elements become playable at different moments, and starting
    // audibly means seven ragged entrances.
    master.gain.value = 0;
    let rejected = false;
    for (const el of elements) {
      el.preservesPitch = false;
      el.playbackRate = 1;
      void el.play().catch(() => {
        rejected = true;
      });
    }

    const began = performance.now();
    const settle = window.setInterval(() => {
      const ready = elements.every((el) => el.readyState >= 3 /* HAVE_FUTURE_DATA */);
      const timedOut = performance.now() - began > START_TIMEOUT_MS;
      if (!ready && !timedOut) {
        return;
      }
      window.clearInterval(settle);
      if (rejected || (!ready && timedOut)) {
        // Six stems playing and one refusing is worse than nothing playing.
        for (const el of elements) {
          el.pause();
        }
        setPhase("failed");
        setFailure(t.cantStart);
        return;
      }
      void alignTo(elements[0]?.currentTime ?? 0).then(() => setPhase("playing"));
    }, 100);
  }, [alignTo, t.cantStart]);

  const pause = useCallback(() => {
    for (const el of elementsRef.current) {
      el.pause();
    }
    setPhase("paused");
  }, []);

  // Space starts and stops, which is what every transport in every DAW does
  // and the first thing anyone tries with an instrument in their hands.
  //
  // Two things it must NOT do. It must not fire while a control has focus —
  // Space is already how you press a focused button and how you nudge a
  // focused range, and stealing it there breaks the keyboard path the faders
  // and M/S depend on. And it must not run while a text field or a
  // contenteditable has focus anywhere on the page.
  //
  // `preventDefault` only once we have decided to act, so Space still scrolls
  // the page when the mixer is not what you are using.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // `code`, not `key`: `code` is the physical key regardless of layout or
      // modifier state, and `key` for the space bar is a single space that is
      // easy to mistype and that some senders spell differently. `key` stays
      // as a fallback for anything that reports no `code`.
      const isSpace = event.code === "Space" || event.key === " ";
      if (!isSpace || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        (target && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName))
      ) {
        return;
      }
      if (phase === "starting") {
        return;
      }
      event.preventDefault();
      if (phase === "playing") {
        pause();
      } else {
        start();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [phase, pause, start]);

  // --- alignment -----------------------------------------------------------

  useEffect(() => {
    if (phase !== "playing") {
      return;
    }
    const id = window.setInterval(() => {
      const elements = elementsRef.current;
      const samples: TrackSample[] = elements.map((el) => ({
        mediaTime: el.readyState >= 1 ? el.currentTime : null,
        ended: el.ended,
        // `readyState < HAVE_FUTURE_DATA` while playing IS buffering.
        stalled: !el.paused && el.readyState < 3,
      }));
      const { state, decision } = decideSync(samples, syncRef.current, DEFAULT_SYNC_TUNING);
      syncRef.current = state;
      const leader =
        decision.leaderIndex === null ? null : (samples[decision.leaderIndex]?.mediaTime ?? null);
      setPosition(leader ?? 0);
      // The axis is the LONGEST track, never the first: a stem is allowed to
      // be shorter than the take. Read here rather than in an effect of its
      // own because this is the one place that already knows metadata has
      // arrived — `duration` is NaN until it has.
      const longest = elements.reduce(
        (max, el) => (Number.isFinite(el.duration) ? Math.max(max, el.duration) : max),
        0,
      );
      if (longest > 0) {
        setDuration((current) => (current === longest ? current : longest));
      }
      if (decision.kind === "resync") {
        void alignTo(decision.targetS);
      }
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phase, alignTo]);

  // --- lifecycle -----------------------------------------------------------

  useEffect(() => {
    // The only hook the Back button reaches. Without it, leaving the page
    // leaves seven streams running with no control anywhere.
    const onHide = (event: PageTransitionEvent) => {
      for (const el of elementsRef.current) {
        el.pause();
      }
      setPhase("paused");
      if (!event.persisted) {
        teardown();
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [teardown]);

  // --- waveforms -----------------------------------------------------------

  useEffect(() => {
    let live = true;
    // All lanes together, because they share one scale: a lane arriving late
    // cannot be drawn until the loudest is known, and drawing then rescaling
    // would make the whole stack jump.
    void Promise.all(
      tracks.map(async (track): Promise<LanePeaks> => {
        try {
          const res = await fetch(`/api/assets/${track.assetId}/peaks`);
          if (!res.ok) {
            return null;
          }
          const body: unknown = await res.json();
          // The contract says a bare array; an older shape wrapped it. Both
          // are accepted for the same reason the player accepts both.
          const raw = Array.isArray(body) ? body : (body as { peaks?: unknown } | null)?.peaks;
          return Array.isArray(raw) && raw.every((v) => typeof v === "number")
            ? (raw as number[])
            : null;
        } catch {
          // A 404 is the ORDINARY case, not an error: per-stem peaks are a
          // real slot in the contract, but whether a stem has one depends on
          // what the bridge uploaded. That lane draws a plain rail.
          return null;
        }
      }),
    ).then((all) => {
      if (live) {
        setLanes(mixerLaneBars(all, bars));
      }
    });
    return () => {
      live = false;
    };
  }, [tracks, bars]);

  useEffect(() => {
    const el = lanesRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) {
        setBars(Math.max(MIN_BARS, Math.min(MAX_BARS, Math.round(width / BAR_PITCH_PX))));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The playhead is ONE element across the whole stack, moved by writing a
  // single custom property. Seven lanes each re-rendering at the transport's
  // rate is not the design — and the value is a fraction so the lanes can
  // position it without knowing their own width.
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const ticks = timelineTicks(duration);

  const scrubTo = useCallback(
    (fraction: number) => {
      if (duration > 0) {
        void alignTo(fraction * duration);
      }
    },
    [alignTo, duration],
  );

  // --- render --------------------------------------------------------------

  const playing = phase === "playing";
  const busy = phase === "starting";

  return (
    <div class="bp-mixer">
      {/* Play, and the preset. The CLOCK is not here — it belongs on the
          ruler's line, beside the axis it reads. */}
      <div class="bp-mixer-transport">
        <button
          type="button"
          class="bp-btn bp-btn-primary"
          disabled={busy}
          onClick={playing ? pause : start}
        >
          {busy ? t.starting : playing ? t.pause : t.play}
        </button>
        {canMuteMine && (
          <button
            type="button"
            class={`bp-btn bp-btn-secondary bp-btn-sm${mix.muteMine ? " is-active" : ""}`}
            aria-pressed={mix.muteMine}
            onClick={() => setMix(toggleMuteMine)}
          >
            {mix.muteMine ? t.unmuteMine : t.muteMine}
          </button>
        )}
      </div>

      {/* `<output>`, not a `<p role="status">`: it IS the element for a
          result the page computed, and it carries the live region for free. */}
      {failure && <output class="bp-mixer-note bp-mixer-failure">{failure}</output>}

      <div class="bp-mixer-lanes" ref={lanesRef} style={`--bp-mix-progress: ${progress}`}>
        {/* One playhead for the stack, not one per lane. `aria-hidden` because
            the ruler's scrub input carries the position for assistive tech. */}
        <span class="bp-mixer-playhead" aria-hidden="true" />
        {/* The scrub gets its OWN row rather than lying over the lanes.
            Overlaying the stack is the obvious construction and it silently
            swallows every mute, solo and fader press underneath — the
            controls are still there, still focusable, and completely
            unclickable. A ruler is also the thing a DAW actually has. */}
        <div class="bp-mixer-ruler">
          {/* The clock lives HERE, in the gutter cell above the track names,
              not up in the page header: it reads the axis beside it, so that
              is the line it belongs on. */}
          <span class="bp-mixer-clock">
            {clock(position)}
            {duration > 0 && <span class="bp-mixer-duration">/ {clock(duration)}</span>}
          </span>
          <div class="bp-mixer-axis">
            <span class="bp-mixer-ruler-rail" aria-hidden="true">
              <span class="bp-mixer-ruler-fill" />
            </span>
            {ticks.map((tick) => (
              <span
                key={tick.atS}
                class="bp-mixer-tick"
                style={{ left: `${tick.fraction * 100}%` }}
                aria-hidden="true"
              >
                {tick.label}
              </span>
            ))}
            <input
              type="range"
              class="bp-mixer-scrub"
              min={0}
              max={1}
              step={0.001}
              value={progress}
              disabled={duration <= 0}
              aria-label={t.seek}
              aria-valuetext={clock(position)}
              onChange={(event) => scrubTo(Number((event.target as HTMLInputElement).value))}
            />
          </div>
        </div>
        {/* The time grid, spanning every lane and sitting BEHIND them — a
            played portion covers its line, an unplayed one shows it through.
            Driven by the SAME `ticks` as the ruler above, so a number and its
            line cannot disagree. */}
        <span class="bp-mixer-grid" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.atS}
              class={`bp-mixer-gridline${tick.major ? " is-major" : ""}`}
              style={{ left: `${tick.fraction * 100}%` }}
            />
          ))}
        </span>
        <ul class="bp-mixer-tracks">
          {mix.tracks.map((control, index) => {
            const track = tracks[index];
            if (!track) {
              return null;
            }
            return (
              <li
                key={control.assetId}
                class={`bp-mixer-track${control.muted ? " is-muted" : ""}`}
                style={`--bp-swatch: ${trackColorVar(track.color)}`}
              >
                {/* The two-line control block: name and M/S on the first line,
                    the fader under them. On a phone it IS the lane; past the
                    breakpoint it becomes the lane's first column, so there is
                    one shape at every width. */}
                <span class="bp-mixer-controls">
                  {/* No colour chip. The fader directly beneath is already
                      this instrument's colour; a chip would say it twice. */}
                  <span class="bp-mixer-track-name">{track.label}</span>
                  {/* M and S as ONE segmented control, not two tiles with a gap:
                    the same two decisions in far less gutter, and they read as
                    a pair. Full 44px halves on a phone — see the stylesheet. */}
                  <span class="bp-mixer-track-buttons">
                    <button
                      type="button"
                      class={`bp-mixer-btn${control.muted ? " is-active" : ""}`}
                      aria-pressed={control.muted}
                      aria-label={control.muted ? t.unmute(track.label) : t.mute(track.label)}
                      onClick={() => setMix((s) => setMuted(s, control.assetId, !control.muted))}
                    >
                      {t.muteShort}
                    </button>
                    <button
                      type="button"
                      class={`bp-mixer-btn${control.soloed ? " is-active" : ""}`}
                      aria-pressed={control.soloed}
                      aria-label={control.soloed ? t.unsolo(track.label) : t.solo(track.label)}
                      onClick={() => setMix((s) => setSoloed(s, control.assetId, !control.soloed))}
                    >
                      {t.soloShort}
                    </button>
                  </span>
                  <input
                    type="range"
                    class="bp-mixer-fader"
                    min={0}
                    max={1.4}
                    step={0.01}
                    value={control.fader}
                    aria-label={t.volume(track.label)}
                    onInput={(event) =>
                      setMix((s) =>
                        setFader(
                          s,
                          control.assetId,
                          Number((event.target as HTMLInputElement).value),
                        ),
                      )
                    }
                  />
                </span>
                {/* The lane's own shape. `aria-hidden` throughout: a waveform is
                  a picture of the audio and says nothing a screen reader can
                  use — the track's name, its controls and the scrub position
                  carry everything that matters. A lane whose source has no
                  peaks draws the rail at the SAME height, so the stack does
                  not jump when one is missing. */}
                {/* Click anywhere on a waveform to move the playhead there —
                    a timeline you cannot click is not a timeline.
                    On the WAVEFORM rather than on the lane, because the lane's
                    other half holds the mute, solo and fader: an overlay
                    across the whole stack is what swallowed those presses the
                    first time round.
                    `aria-hidden` stays. This is a mouse shortcut for something
                    the ruler's range input already does properly with a
                    keyboard, not a control in its own right — so it must not
                    appear twice to a screen reader. */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: the ruler's range input IS this control's keyboard path; a second one here is the same seek twice */}
                <span
                  class="bp-mixer-wave"
                  aria-hidden="true"
                  onClick={(event) => {
                    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
                    if (box.width > 0) {
                      scrubTo(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
                    }
                  }}
                >
                  {lanes[index] ? (
                    lanes[index]?.map((value, bar) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: bar N is bar N
                        key={bar}
                        class="bp-mixer-bar"
                        style={{ height: `${Math.max(6, value * 100)}%` }}
                      />
                    ))
                  ) : (
                    <span class="bp-mixer-rail" />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {onlyInMaster.length > 0 && (
        <p class="bp-mixer-note">{t.onlyInMaster(onlyInMaster.join(", "))}</p>
      )}
      <p class="bp-mixer-note">{t.silenceHint}</p>
    </div>
  );
}

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
import {
  DEFAULT_SYNC_TUNING,
  INITIAL_SYNC_STATE,
  type SyncState,
  type TrackSample,
  decideSync,
  resetSyncState,
} from "../client/mixer-sync.js";
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
  // Position and the live spread across tracks. The spread is not debug
  // output: this engine cannot promise phase coherence, so the one honest
  // thing to do is show how far apart the tracks actually are rather than
  // let someone assume it is zero.
  const [position, setPosition] = useState(0);
  const [spreadMs, setSpreadMs] = useState(0);

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
      setSpreadMs(decision.worstErrorS * 1000);
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

  // --- render --------------------------------------------------------------

  const playing = phase === "playing";
  const busy = phase === "starting";

  return (
    <div class="bp-mixer">
      <div class="bp-mixer-transport">
        <button
          type="button"
          class="bp-btn bp-btn-primary"
          disabled={busy}
          onClick={playing ? pause : start}
        >
          {busy ? t.starting : playing ? t.pause : t.play}
        </button>
        <span class="bp-mixer-clock">
          {clock(position)}
          {/* Named, not a bare number: "3 ms" beside a transport means nothing
              on its own, and the figure is the one caveat this engine has. */}
          <span class="bp-mixer-spread">±{spreadMs.toFixed(0)} ms</span>
        </span>
        {canMuteMine && (
          <button
            type="button"
            class={`bp-btn bp-btn-secondary${mix.muteMine ? " is-active" : ""}`}
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

      <ul class="bp-mixer-tracks">
        {mix.tracks.map((control, index) => {
          const track = tracks[index];
          if (!track) {
            return null;
          }
          return (
            <li
              key={control.assetId}
              class="bp-mixer-track"
              style={`--bp-swatch: ${trackColorVar(track.color)}`}
            >
              <span class="bp-mixer-track-name">
                <span class="bp-color-dot" aria-hidden="true" />
                {track.label}
              </span>
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
                    setFader(s, control.assetId, Number((event.target as HTMLInputElement).value)),
                  )
                }
              />
            </li>
          );
        })}
      </ul>

      {onlyInMaster.length > 0 && (
        <p class="bp-mixer-note">{t.onlyInMaster(onlyInMaster.join(", "))}</p>
      )}
      <p class="bp-mixer-note">{t.fullMixNote}</p>
      <p class="bp-mixer-note">{t.silenceHint}</p>
    </div>
  );
}

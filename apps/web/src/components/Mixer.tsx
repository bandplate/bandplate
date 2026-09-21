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
import { ArrowLeftFromLine, ArrowRightFromLine, Pause, Play, UserX, X } from "lucide-preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";
import {
  canLoop,
  LOOP_NUDGE_S,
  type LoopEdge,
  type LoopRegion,
  loopFractions,
  makeLoop,
  nudgeLoopEdge,
  setLoopEdge,
} from "../client/mixer-loop.js";
import { type LanePeaks, mixerLaneBars } from "../client/mixer-peaks.js";
import { timelineTicks } from "../client/mixer-ticks.js";
import {
  initialMixerState,
  MAX_FADER,
  type MixerState,
  setFader,
  setMuted,
  setSoloed,
  toggleMuteMine,
  trackGains,
} from "../client/mixer-tracks.js";
import { parsePeaksBody } from "../client/player-store.js";
import { barCountForWidth, formatClock, fractionAt, playedFraction } from "../client/timeline.js";
import { type MixerFailure, useMixerEngine } from "../client/use-mixer-engine.js";

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

/** One bar per this many CSS pixels, matching the player's waveform. */
const BAR_PITCH_PX = 3;
/** How far a pointer must travel on the loop bar before it counts as a drag rather than a tap. */
const DRAG_SLOP_PX = 4;
const MIN_BARS = 40;
const MAX_BARS = 600;

/**
 * The engine reports WHY it stopped; the words are chosen here, in the
 * reader's language. Same division this app keeps everywhere between a
 * decision and the sentence for it.
 */
function failureText(
  t: ReturnType<typeof mixerMessages>,
  tracks: MixerTrackProps[],
  failure: MixerFailure,
): string {
  if (failure.kind === "cant-start") {
    return t.cantStart;
  }
  return t.trackFailed(tracks[failure.index]?.label ?? "");
}

export default function Mixer({ tracks, canMuteMine, onlyInMaster, locale }: MixerProps) {
  const t = mixerMessages(currentLocale(locale));

  const [mix, setMix] = useState<MixerState>(() => initialMixerState(tracks));
  const [lanes, setLanes] = useState<(number[] | null)[]>(() => tracks.map(() => null));
  /**
   * Whether the waveforms are still arriving.
   *
   * Distinct from "this lane has none", which is a permanent state that draws
   * a rail — without the distinction a stack of rails means either "still
   * loading" or "the bridge never uploaded these" and the reader cannot tell
   * which.
   */
  const [lanesLoading, setLanesLoading] = useState(true);
  const [bars, setBars] = useState(160);
  const lanesRef = useRef<HTMLDivElement | null>(null);
  /**
   * The ruler's axis — the same grid track the waveforms occupy.
   *
   * The bar count is measured from THIS, not from the lane stack: the stack
   * includes the control gutter, so measuring it asked for a third again as
   * many bars as the column can hold, and they came out 1.2px wide with a 1px
   * gap between them.
   */
  const axisRef = useRef<HTMLDivElement | null>(null);

  // Mute, solo and fader resolve to one number per track HERE, in a pure
  // module, and the engine is handed the result — so it never learns what a
  // mute is, and the rule stays somewhere a node-only test can reach.
  // Memoised on the CONTROLS, not recomputed per render: the engine reports a
  // position four times a second, and a fresh Map each time would re-ramp
  // every GainNode on every tick for no change at all.
  const gains = useMemo(() => trackGains(mix.tracks), [mix.tracks]);
  /**
   * The loop region, or null.
   *
   * Its EXISTENCE is what arms it — there is no separate on switch. Two
   * states where one will do, and clearing is one press either way.
   */
  const [loop, setLoop] = useState<LoopRegion | null>(null);
  const engine = useMixerEngine({ sources: tracks, gains, loop });
  const { phase, position, duration, buffering, failure } = engine;

  // --- waveforms -----------------------------------------------------------

  useEffect(() => {
    let live = true;
    setLanesLoading(true);
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
          // The contract's bare array or the older wrapped shape, read the
          // same way the player reads them.
          return parsePeaksBody(await res.json());
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
        setLanesLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [tracks, bars]);

  useEffect(() => {
    const el = axisRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const width = el.getBoundingClientRect().width;
      const count = barCountForWidth(width, { pitch: BAR_PITCH_PX, min: MIN_BARS, max: MAX_BARS });
      if (count !== null) {
        setBars(count);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The playhead is ONE element across the whole stack, moved by writing a
  // single custom property. Seven lanes each re-rendering at the transport's
  // rate is not the design — and the value is a fraction so the lanes can
  // position it without knowing their own width.
  const progress = Math.min(1, playedFraction(position, duration));
  const ticks = timelineTicks(duration);

  const scrubTo = useCallback(
    (fraction: number) => {
      if (duration > 0) {
        engine.seekTo(fraction * duration);
      }
    },
    [engine, duration],
  );

  // --- the loop bar --------------------------------------------------------

  const loopBarRef = useRef<HTMLDivElement | null>(null);
  const loopable = canLoop(duration);
  const band = loopFractions(loop, duration);

  /** Where on the take a pointer is, or null when there is no axis to read yet. */
  const timeAtX = useCallback(
    (clientX: number): number | null => {
      const bar = loopBarRef.current;
      if (!bar || duration <= 0) {
        return null;
      }
      const fraction = fractionAt(clientX, bar.getBoundingClientRect());
      return fraction === null ? null : fraction * duration;
    },
    [duration],
  );

  /**
   * One gesture for both jobs: dragging across empty bar makes a region, and
   * dragging a handle moves one edge.
   *
   * `fixedS` is the edge that stays — the far handle when adjusting, the
   * place the drag began when creating. `makeLoop` anchors on it, so the
   * minimum length always gives on the edge under the finger, and dragging
   * one handle past the other swaps them instead of jamming.
   */
  const dragFrom = useCallback(
    (event: PointerEvent, fixedS: number) => {
      const bar = loopBarRef.current;
      if (!bar || !loopable) {
        return;
      }
      // Captured on the BAR, not on the handle: a drag that leaves a 10px
      // handle must keep tracking, and it will leave it immediately.
      // Guarded because capture throws outright if the pointer is already
      // gone, which takes the whole gesture down with it.
      try {
        bar.setPointerCapture(event.pointerId);
      } catch {
        // Tracking still works without capture; it just stops at the edge.
      }
      const fromX = event.clientX;
      let dragging = false;
      const onMove = (e: PointerEvent) => {
        // A press that never travels is a press, not a drag. Without the
        // threshold a stray tap drops a 1.5-second region in and playback
        // starts jumping for no reason the member can see.
        dragging = dragging || Math.abs(e.clientX - fromX) >= DRAG_SLOP_PX;
        const to = dragging ? timeAtX(e.clientX) : null;
        if (to !== null) {
          setLoop(makeLoop(fixedS, to, duration));
        }
      };
      const onUp = () => {
        bar.removeEventListener("pointermove", onMove);
        bar.removeEventListener("pointerup", onUp);
        bar.removeEventListener("pointercancel", onUp);
        if (bar.hasPointerCapture(event.pointerId)) {
          bar.releasePointerCapture(event.pointerId);
        }
      };
      bar.addEventListener("pointermove", onMove);
      bar.addEventListener("pointerup", onUp);
      bar.addEventListener("pointercancel", onUp);
    },
    [duration, loopable, timeAtX],
  );

  /**
   * Arrow keys on a handle — and the reason the handles are hand-rolled at
   * all. This project's rule is never to rebuild an interaction the platform
   * ships, but there IS no two-thumb range input: ARIA's own answer to a
   * range slider is two elements with `role="slider"`, so that is what these
   * are, keyboard included.
   */
  const onHandleKey = useCallback(
    (event: KeyboardEvent, edge: LoopEdge) => {
      const step = event.shiftKey ? LOOP_NUDGE_S * 4 : LOOP_NUDGE_S;
      const delta =
        event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -step
          : event.key === "ArrowRight" || event.key === "ArrowUp"
            ? step
            : 0;
      if (delta === 0) {
        return;
      }
      // Only once we have decided to act, so an arrow key still scrolls the
      // page everywhere else.
      event.preventDefault();
      setLoop((region) => nudgeLoopEdge(region, edge, delta, duration));
    },
    [duration],
  );

  // --- render --------------------------------------------------------------

  const playing = phase === "playing";
  const busy = phase === "starting";

  return (
    <div class="bp-mixer">
      {/* `<output>`, not a `<p role="status">`: it IS the element for a
          result the page computed, and it carries the live region for free. */}
      {failure && (
        <output class="bp-mixer-note bp-mixer-failure">{failureText(t, tracks, failure)}</output>
      )}

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
          {/* EVERY control lives in the gutter cell, on the ruler's own line:
              play, the preset, and the clock right against the axis it reads.
              A separate transport row above sat on no edge that anything else
              shared and read as page furniture rather than as this tool's
              controls. */}
          <span class="bp-mixer-controls-cell">
            {/* The gold disc every other play control in this app is — the
                take hero's, a take row's, the home shelf's. `.bp-play-toggle`
                carries the disc, the ring and the icon swap; `aria-pressed`
                flips it, exactly as `syncButtons` drives the shell player's. */}
            <button
              type="button"
              class="bp-play-toggle"
              aria-pressed={playing}
              aria-label={playing ? t.pause : t.play}
              disabled={busy}
              onClick={playing ? engine.pause : engine.play}
            >
              <Play size={18} class="bp-play-icon-play" aria-hidden="true" fill="currentColor" />
              <Pause size={18} class="bp-play-icon-pause" aria-hidden="true" fill="currentColor" />
            </button>
            <span class="bp-mixer-clock">
              {formatClock(position)}
              {duration > 0 && <span class="bp-mixer-duration">/ {formatClock(duration)}</span>}
            </span>
            {canMuteMine && (
              /* Icon-only, because the gutter is 184px and the sentence does
                 not fit beside a transport. The label is not lost — it is the
                 button's accessible name and its tooltip; what is lost is
                 reading it without hovering, which is the price of keeping
                 every control on one line. */
              <button
                type="button"
                class={`bp-mixer-preset${mix.muteMine ? " is-active" : ""}`}
                aria-pressed={mix.muteMine}
                aria-label={mix.muteMine ? t.unmuteMine : t.muteMine}
                title={mix.muteMine ? t.unmuteMine : t.muteMine}
                onClick={() => setMix(toggleMuteMine)}
              >
                <UserX size={17} aria-hidden="true" strokeWidth={2.2} />
              </button>
            )}
          </span>
          <div class="bp-mixer-axis" ref={axisRef}>
            <span class="bp-mixer-ruler-rail" aria-hidden="true">
              <span class="bp-mixer-ruler-fill" />
            </span>
            {/* The origin keeps its gridline but loses its number. It is the
                only label with nothing to its left but the gutter's own
                controls, so it sits against them and reads as theirs rather
                than as the line's — and a timeline that starts at zero does
                not need to say so, least of all beside a clock that already
                reads the position. */}
            {ticks
              .filter((tick) => tick.atS > 0)
              .map((tick) => (
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
              aria-valuetext={formatClock(position)}
              onChange={(event) => scrubTo(Number((event.target as HTMLInputElement).value))}
            />
          </div>
        </div>
        {/* The loop bar, on its OWN strip rather than on the axis.
            It cannot share the axis: the scrub input owns every pointer
            there, so a drag across it would move the playhead instead of
            marking a passage. A DAW puts its cycle on a separate ruler for
            exactly this reason.

            Two ways in, because they suit different hands. Dragging is quick
            with a mouse. The two mark buttons need no precision and no second
            hand, which is what makes the loop usable on a phone propped
            against a music stand — the one thing this feature could not be
            allowed to lose at the small breakpoint. */}
        <div class="bp-mixer-loop">
          <span class="bp-mixer-loop-cell">
            <span class="bp-mixer-loop-buttons">
              <button
                type="button"
                class="bp-mixer-btn"
                aria-label={t.loopFrom}
                title={t.loopFrom}
                disabled={!loopable}
                onClick={() => setLoop((r) => setLoopEdge(r, "start", position, duration))}
              >
                <ArrowRightFromLine size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                class="bp-mixer-btn"
                aria-label={t.loopTo}
                title={t.loopTo}
                disabled={!loopable}
                onClick={() => setLoop((r) => setLoopEdge(r, "end", position, duration))}
              >
                <ArrowLeftFromLine size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                class="bp-mixer-btn"
                aria-label={t.loopClear}
                title={t.loopClear}
                disabled={!loop}
                onClick={() => setLoop(null)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </span>
            {loop && (
              <span class="bp-mixer-loop-times">
                {formatClock(loop.startS)}–{formatClock(loop.endS)}
              </span>
            )}
          </span>
          {/* No click handler, so no keyboard equivalent is owed here: the
              two handles below carry the keyboard path, and the mark buttons
              beside it carry the pointer-free one. */}
          <div
            class="bp-mixer-loopbar"
            ref={loopBarRef}
            onPointerDown={(event) => {
              if (event.button !== 0 && event.pointerType === "mouse") {
                return;
              }
              const at = timeAtX(event.clientX);
              if (at !== null) {
                dragFrom(event, at);
              }
            }}
          >
            {band && loop ? (
              <>
                <span
                  class="bp-mixer-loop-band"
                  aria-hidden="true"
                  title={t.loopRegion(formatClock(loop.startS), formatClock(loop.endS))}
                  style={`--bp-loop-a: ${band.start}; --bp-loop-b: ${band.end}`}
                />
                {/* Hand-rolled, and this is the one place in the app where
                    that is the correct answer rather than the lazy one: there
                    is no two-thumb range input to reach for, and ARIA's own
                    pattern for a range slider IS two elements with
                    `role="slider"`. Arrow keys included — see `onHandleKey`. */}
                <span
                  class="bp-mixer-loop-handle is-start"
                  role="slider"
                  tabIndex={0}
                  aria-label={t.loopStartHandle}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={loop.startS}
                  aria-valuetext={formatClock(loop.startS)}
                  style={`--bp-loop-at: ${band.start}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    dragFrom(event, loop.endS);
                  }}
                  onKeyDown={(event) => onHandleKey(event, "start")}
                />
                <span
                  class="bp-mixer-loop-handle is-end"
                  role="slider"
                  tabIndex={0}
                  aria-label={t.loopEndHandle}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={loop.endS}
                  aria-valuetext={formatClock(loop.endS)}
                  style={`--bp-loop-at: ${band.end}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    dragFrom(event, loop.startS);
                  }}
                  onKeyDown={(event) => onHandleKey(event, "end")}
                />
              </>
            ) : (
              loopable && <span class="bp-mixer-loop-hint">{t.loopHint}</span>
            )}
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
        {/* Over the waveform column, which is where the waiting actually is —
            and the only place with room for a sentence. In the 11.5rem gutter
            it sat on the clock. While it shows, the lanes below it are
            skeletons anyway. */}
        {(busy || buffering) && <output class="bp-mixer-status">{t.starting}</output>}
        <ul class="bp-mixer-tracks" aria-busy={lanesLoading}>
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
                  {/* The filled part of the track is drawn by CSS, and CSS
                    cannot read an input's value — so the position rides along
                    as a custom property. Unitless 0..1, not a percentage:
                    the track has to subtract the thumb's own width from the
                    travel before it can turn this into a length. */}
                  <input
                    type="range"
                    class="bp-mixer-fader"
                    min={0}
                    max={MAX_FADER}
                    step={0.01}
                    value={control.fader}
                    style={`--bp-fader-pos: ${control.fader / MAX_FADER}`}
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
                <span
                  class="bp-mixer-wave"
                  aria-hidden="true"
                  onClick={(event) => {
                    const fraction = fractionAt(
                      event.clientX,
                      (event.currentTarget as HTMLElement).getBoundingClientRect(),
                    );
                    if (fraction !== null) {
                      scrubTo(fraction);
                    }
                  }}
                >
                  {lanesLoading ? (
                    // A skeleton, not the rail: the rail means "this source
                    // has no waveform", which is permanent, and using it here
                    // would say that of every lane for as long as the fetch
                    // takes. `/dev/ui`'s skeleton is documented for exactly
                    // this — an island fetching after mount.
                    <span class="bp-skeleton bp-mixer-wave-skeleton" />
                  ) : lanes[index] ? (
                    lanes[index]?.map((value, bar) => (
                      <span
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

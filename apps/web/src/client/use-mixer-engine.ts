// The mixer's audio engine: the graph, the transport, seeking and alignment.
//
// Split out of `Mixer.tsx` after three bugs in one afternoon, all of them in
// the seam between "what the audio is doing" and "what the page is showing":
// a flag that outlived its scope, playback state inferred from elements the
// operation had itself paused, and a position with two writers. Every ref
// lives behind this boundary now, and the component gets values it can only
// read.
//
// It owns no copy and no markup. A failure comes back as a REASON, and the
// component says it in the reader's language — the same division the rest of
// this app keeps between a decision and the words for it.
//
// What it deliberately does NOT own: which tracks are muted or soloed. Gains
// arrive already computed (see `mixer-tracks.ts`), so the engine never learns
// what a mute is and the rule stays in a module a node-only test can reach.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { type LoopRegion, loopEngagedFrom, loopWrapTarget } from "./mixer-loop.js";
import {
  DEFAULT_SYNC_TUNING,
  INITIAL_SYNC_STATE,
  type SyncState,
  type TrackSample,
  decideSync,
  pickLeader,
  resetSyncState,
} from "./mixer-sync.js";

/** How often alignment is checked. A timer, not rAF: rAF stops dead in a background tab. */
const SYNC_INTERVAL_MS = 250;

/** Mutes and un-mutes ramp rather than jump, or every press is a click. */
const GAIN_RAMP_S = 0.015;

/** Give up waiting for a track to become playable. Long, because this is a cold start over the network. */
const START_TIMEOUT_MS = 20_000;

export type MixerPhase = "idle" | "starting" | "playing" | "paused" | "failed";

/** Why the engine stopped. The component turns it into a sentence. */
export type MixerFailure = { kind: "cant-start" } | { kind: "track"; index: number };

/** All the engine needs to know about a track: where its audio is. */
export interface MixerSource {
  assetId: string;
}

export interface MixerEngineInput {
  /** Stable for the life of the take — the graph is built once from it. */
  sources: readonly MixerSource[];
  /** Effective gain per asset id, already resolved from mute, solo and fader. */
  gains: Map<string, number>;
  /** The region to repeat, or null to play straight through. */
  loop?: LoopRegion | null;
}

export interface MixerEngine {
  phase: MixerPhase;
  /** Seconds, from the healthy leader — or from a seek that has just been asked for. */
  position: number;
  /** The longest track. A stem is allowed to be shorter than the take. */
  duration: number;
  /** Any track waiting on bytes. */
  buffering: boolean;
  failure: MixerFailure | null;
  play: () => void;
  pause: () => void;
  /** Put every element on the same instant. Safe to call while playing or stopped. */
  seekTo: (seconds: number) => void;
}

export function useMixerEngine({ sources, gains, loop = null }: MixerEngineInput): MixerEngine {
  const [phase, setPhase] = useState<MixerPhase>("idle");
  const [failure, setFailure] = useState<MixerFailure | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const elementsRef = useRef<HTMLAudioElement[]>([]);
  const gainsRef = useRef<GainNode[]>([]);
  const wiredRef = useRef<boolean[]>([]);
  const syncRef = useRef<SyncState>(INITIAL_SYNC_STATE);
  /**
   * Which seek is current.
   *
   * A seek that has been superseded must abandon its own tail rather than
   * restoring a gain the newer one is still ramping.
   */
  const seekGenerationRef = useRef(0);
  /**
   * How many seeks are in flight. A COUNT, not a flag.
   *
   * A flag looked equivalent and was not: a superseded seek returned early
   * without clearing it, so after two overlapping clicks the sync loop stood
   * down permanently. The clock froze and every later click moved a dead
   * indicator. Incremented once per call and decremented in a `finally`, so
   * no early return can leave it raised.
   */
  const pendingSeeksRef = useRef(0);
  /**
   * Whether playback is INTENDED, as opposed to whether the elements happen
   * to be running right now.
   *
   * `seekTo` pauses every element before it seeks, so a second seek arriving
   * mid-flight asked "are they playing?" and was told no — by the first
   * seek's own pause. It then finished without resuming, leaving the audio
   * stopped while the transport still said playing. Intent cannot be read off
   * the things the operation itself suspends.
   */
  const shouldPlayRef = useRef(false);
  /** Where the transport is, readable from a loop that must not re-render to see it. */
  const positionRef = useRef(0);
  const loopRef = useRef<LoopRegion | null>(null);
  /**
   * Whether the loop is holding THIS playback, decided each time playback
   * lands somewhere.
   *
   * Not derived from the position at the moment of the check: landing past
   * the region's end means you have left it, and something that only asked
   * "are we past the end?" would yank you back the one time you jumped ahead
   * to hear the ending.
   */
  const engagedRef = useRef(false);

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

    sources.forEach((source, index) => {
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
      el.src = `/api/assets/${source.assetId}/audio`;

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
        setFailure({ kind: "track", index });
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
    // Built once for this take.
  }, [sources, teardown]);

  // --- gains ---------------------------------------------------------------

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) {
      return;
    }
    sources.forEach((source, index) => {
      const gain = gainsRef.current[index];
      if (!gain) {
        return;
      }
      // Ramped, not assigned: an instant gain change is a click.
      gain.gain.setTargetAtTime(gains.get(source.assetId) ?? 0, ctx.currentTime, GAIN_RAMP_S);
    });
  }, [gains, sources]);

  // --- transport -----------------------------------------------------------

  /**
   * Put every element on the same instant.
   *
   * Stop-the-world, never a compensated `currentTime = leader + guess`: the
   * seek latency is unknowable and wrong differently on every engine. Costs a
   * short hole in the audio, which is rare and beats a long detune.
   */
  const alignTo = useCallback((targetS: number) => {
    void (async () => {
      const elements = elementsRef.current;
      const master = masterRef.current;
      const ctx = ctxRef.current;
      if (!ctx || !master) {
        return;
      }
      const generation = ++seekGenerationRef.current;
      pendingSeeksRef.current++;
      try {
        master.gain.setTargetAtTime(0, ctx.currentTime, GAIN_RAMP_S);
        // The playhead moves HERE, not only from the sync loop. That loop runs
        // while playing, so leaving it to report the new position meant a seek
        // did nothing visible whenever the mixer was paused or had never been
        // started — which is most of the time someone spends clicking a
        // timeline.
        setPosition(targetS);
        positionRef.current = targetS;
        engagedRef.current = loopEngagedFrom(targetS, loopRef.current);
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
        // A newer seek started while this one waited on `seeked`. Its target is
        // the one that should win, and it will restore the gain itself —
        // finishing here would fight it.
        if (seekGenerationRef.current !== generation) {
          return;
        }
        if (shouldPlayRef.current) {
          for (const el of elements) {
            void el.play().catch(() => undefined);
          }
        }
        syncRef.current = resetSyncState();
        master.gain.setTargetAtTime(1, ctx.currentTime, GAIN_RAMP_S);
      } finally {
        pendingSeeksRef.current = Math.max(0, pendingSeeksRef.current - 1);
      }
    })();
  }, []);

  const start = useCallback(() => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    const elements = elementsRef.current;
    if (!ctx || !master || elements.length === 0) {
      return;
    }
    setFailure(null);
    setPhase("starting");
    shouldPlayRef.current = true;
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
        shouldPlayRef.current = false;
        for (const el of elements) {
          el.pause();
        }
        setPhase("failed");
        setFailure({ kind: "cant-start" });
        return;
      }
      alignTo(elements[0]?.currentTime ?? 0);
      setPhase("playing");
    }, 100);
  }, [alignTo]);

  const pause = useCallback(() => {
    shouldPlayRef.current = false;
    for (const el of elementsRef.current) {
      el.pause();
    }
    setPhase("paused");
    setBuffering(false);
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
      // Stand down where Space already MEANS something: it presses a focused
      // button or link, toggles a checkbox, and types into a field.
      //
      // A range is the exception, and it matters here: dragging the scrub
      // leaves it focused, and Space has no standard action on a range — so
      // guarding every INPUT meant that after one scrub the transport's own
      // key silently stopped working, which is exactly when someone reaches
      // for it.
      const isRange = target instanceof HTMLInputElement && target.type === "range";
      if (
        !isRange &&
        (target?.isContentEditable ||
          (target && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName)))
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
      // Mid-seek the elements still report where they WERE. Reading them here
      // is what made a click on the timeline look unreliable.
      if (pendingSeeksRef.current > 0) {
        return;
      }
      const elements = elementsRef.current;
      const samples = sampleTracks(elements);
      setBuffering(samples.some((sample) => sample.stalled));
      // Before the alignment decision, and it returns early when it acts: a
      // wrap is itself a stop-the-world seek, and asking for a resync in the
      // same tick would fight it.
      if (checkEnd(samples, elements)) {
        return;
      }
      const { state, decision } = decideSync(samples, syncRef.current, DEFAULT_SYNC_TUNING);
      syncRef.current = state;
      const leader =
        decision.leaderIndex === null ? null : (samples[decision.leaderIndex]?.mediaTime ?? null);
      // Only when there IS one. Falling back to zero meant that a moment
      // where every track was buffering at once threw the playhead back to
      // the start of the take, and the end of a take parked it there.
      if (leader !== null) {
        setPosition(leader);
        positionRef.current = leader;
      }
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

  // --- loop ----------------------------------------------------------------

  useEffect(() => {
    loopRef.current = loop;
    // A region that MOVES under a running transport has to re-decide whether
    // it is holding this playback. Without it, dragging the end past the
    // playhead leaves a loop that never catches, and dragging it back leaves
    // one that catches when it should not.
    engagedRef.current = loopEngagedFrom(positionRef.current, loop);
  }, [loop]);

  /**
   * The end of the region, and the end of the take.
   *
   * Called from BOTH loops below, which is the point: one of them is precise
   * and one of them survives the tab going away, and a practice tool needs
   * each of those at different moments.
   */
  const checkEnd = useCallback(
    (samples: readonly TrackSample[], elements: readonly HTMLAudioElement[]): boolean => {
      // Every track out of audio, which is NOT the same as no leader: all of
      // them buffering at once also leaves none, and stopping there would
      // turn a network hiccup into the end of the song.
      const allEnded = samples.length > 0 && samples.every((sample) => sample.ended);
      const leaderIndex = pickLeader(samples);
      const positionS = leaderIndex === null ? null : samples[leaderIndex]?.mediaTime;
      if (!allEnded && (positionS === null || positionS === undefined)) {
        return false;
      }
      const target = loopWrapTarget({
        positionS: positionS ?? 0,
        region: loopRef.current,
        engaged: engagedRef.current,
        ended: allEnded,
      });
      if (target !== null) {
        alignTo(target);
        return true;
      }
      if (allEnded) {
        // Ran off the end with no loop to catch it. Without this the tracks
        // stop while the transport still says playing, and the playhead sits
        // wherever the last tick happened to leave it.
        const longest = elements.reduce(
          (max, el) => (Number.isFinite(el.duration) ? Math.max(max, el.duration) : max),
          0,
        );
        pause();
        if (longest > 0) {
          setPosition(longest);
          positionRef.current = longest;
        }
        return true;
      }
      return false;
    },
    [alignTo, pause],
  );

  const sampleTracks = useCallback(
    (elements: readonly HTMLAudioElement[]): TrackSample[] =>
      elements.map((el) => ({
        mediaTime: el.readyState >= 1 ? el.currentTime : null,
        ended: el.ended,
        // `readyState < HAVE_FUTURE_DATA` while playing IS buffering.
        stalled: !el.paused && el.readyState < 3,
      })),
    [],
  );

  /**
   * The precise watch: rAF, so a wrap lands within a frame of the region's
   * end rather than up to a quarter of a second past it. A 250ms tick would
   * let the next bar start before every repeat, which is musically absurd.
   *
   * It stops dead in a background tab — which is why it is not the only
   * watch. The alignment timer below carries the same check at 250ms, and a
   * practice loop that keeps going while you read a chord chart in another
   * tab, a little late at the seam, beats one that quietly stops looping.
   */
  useEffect(() => {
    if (phase !== "playing") {
      return;
    }
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      // Mid-seek the elements still report where they WERE — including the
      // wrap's own seek, which would otherwise re-fire on every frame until
      // it landed.
      if (pendingSeeksRef.current > 0) {
        return;
      }
      const elements = elementsRef.current;
      if (elements.length > 0) {
        checkEnd(sampleTracks(elements), elements);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, checkEnd, sampleTracks]);

  // --- lifecycle -----------------------------------------------------------

  useEffect(() => {
    // The only hook the Back button reaches. Without it, leaving the page
    // leaves seven streams running with no control anywhere.
    const onHide = (event: PageTransitionEvent) => {
      shouldPlayRef.current = false;
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

  return { phase, position, duration, buffering, failure, play: start, pause, seekTo: alignTo };
}

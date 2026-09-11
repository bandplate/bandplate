// Keeping N streaming tracks together — and the measured reason there is far
// less here than the design expected.
//
// `/dev/sync` was built to answer one question before any of this was
// written: how far apart do N `HTMLMediaElement`s drift? On Chrome, over five
// minutes, through one `AudioContext`, the answer was **zero ppm**. Six tracks
// held to a 2.9ms spread that never grew, and `currentTime` resolved to
// 0.6-2.2ms -- an order of magnitude finer than the 26ms mp3 frame granule the
// design had budgeted for.
//
// So there is NO SERVO here. No error filter, no proportional gain, no
// `playbackRate` trim. Writing a control loop for a disturbance that measured
// zero would be building machinery whose only effect is its own bugs. What
// remains is the part that is actually needed: notice when a track has come
// adrift, and put everyone back together in one move.
//
// The door is left open deliberately. Safari is unmeasured, and its media
// clock granule may be a whole mp3 frame; if a browser turns up that genuinely
// drifts, a rate trim belongs here, behind the same `SyncTuning`, and
// `/dev/sync?rate=1` is where it gets proved.
//
// Pure, per this repo's rule: every decision reachable by a node-only vitest,
// nothing but the Web Audio calls left in the island.

/** One track's state at one tick, as the island observes it. */
export interface TrackSample {
  /** `currentTime`, or null when the element is not ready to report one. */
  mediaTime: number | null;
  ended: boolean;
  /** Buffering — waiting on bytes, so its clock is legitimately not advancing. */
  stalled: boolean;
}

export interface SyncTuning {
  /** How far adrift a track may be before it counts as a breach, in seconds. */
  resyncThresholdS: number;
  /**
   * Consecutive breaches before a resync fires.
   *
   * Two, never one. A single sample can land on the wrong side of a clock's
   * own quantisation, and a resync is a stop-the-world with an audible hole in
   * it — the most expensive thing this module can ask for.
   */
  resyncBreaches: number;
}

export const DEFAULT_SYNC_TUNING: SyncTuning = {
  resyncThresholdS: 0.15,
  resyncBreaches: 2,
};

export interface SyncState {
  breaches: number;
  /** Which track is currently the reference, or null when none is healthy. */
  leaderIndex: number | null;
}

export const INITIAL_SYNC_STATE: SyncState = { breaches: 0, leaderIndex: null };

export type SyncDecision =
  | { kind: "hold"; leaderIndex: number | null; worstErrorS: number }
  | { kind: "resync"; leaderIndex: number; targetS: number; worstErrorS: number };

/**
 * A track worth measuring against.
 *
 * Not "ready": a track can be ready and still be useless as a reference or a
 * follower. An ENDED track's clock is frozen at its own duration, so its
 * apparent error grows without bound — and a stem is allowed to be shorter
 * than the take. A STALLED track's clock is legitimately not advancing while
 * it waits for bytes; measuring against it reports drift that is really
 * buffering.
 */
function isHealthy(sample: TrackSample): boolean {
  return sample.mediaTime !== null && !sample.ended && !sample.stalled;
}

/**
 * The reference track: the lowest-indexed HEALTHY one.
 *
 * The design said "index 0, permanently", and the probe showed why that is
 * wrong. On one run the master stalled; because it was index 0, all six
 * healthy tracks were measured against a stopped clock and reported 882,551
 * ppm of drift and a fifteen-second error while being in perfect agreement
 * with each other. A reference that can stall is a reference that
 * manufactures emergencies.
 *
 * Still stable under the thing the original rule was protecting: mute is a
 * `GainNode` change and never a `pause()`, so muting a track does not move the
 * reference and put a step into everybody's error at once.
 */
export function pickLeader(samples: readonly TrackSample[]): number | null {
  for (const [index, sample] of samples.entries()) {
    if (isHealthy(sample)) {
      return index;
    }
  }
  return null;
}

/**
 * Decide whether the set has come apart badly enough to be put back together.
 *
 * Returns the next state alongside the decision so nothing is remembered in a
 * closure — the breach counter has to survive between ticks and must be reset
 * by the caller after any discontinuity (a seek, a loop wrap, a resync), which
 * is only possible if it is a value.
 */
export function decideSync(
  samples: readonly TrackSample[],
  prev: SyncState,
  tuning: SyncTuning = DEFAULT_SYNC_TUNING,
): { state: SyncState; decision: SyncDecision } {
  const leaderIndex = pickLeader(samples);
  if (leaderIndex === null) {
    // Nothing healthy to measure against. Not an emergency — everything is
    // buffering, or the take has ended.
    return {
      state: { breaches: 0, leaderIndex: null },
      decision: { kind: "hold", leaderIndex: null, worstErrorS: 0 },
    };
  }

  const leaderTime = samples[leaderIndex]?.mediaTime ?? 0;
  let worstErrorS = 0;
  for (const [index, sample] of samples.entries()) {
    if (index === leaderIndex || !isHealthy(sample)) {
      continue;
    }
    const error = Math.abs((sample.mediaTime ?? 0) - leaderTime);
    if (error > worstErrorS) {
      worstErrorS = error;
    }
  }

  const breached = worstErrorS > tuning.resyncThresholdS;
  // Reset rather than decrement: the counter is asking "has this been wrong
  // continuously", and one good sample answers no.
  const breaches = breached ? prev.breaches + 1 : 0;

  if (breaches >= tuning.resyncBreaches) {
    return {
      state: { breaches: 0, leaderIndex },
      decision: { kind: "resync", leaderIndex, targetS: leaderTime, worstErrorS },
    };
  }
  return {
    state: { breaches, leaderIndex },
    decision: { kind: "hold", leaderIndex, worstErrorS },
  };
}

/** After a seek, a loop wrap or a resync — the counter must not survive a discontinuity. */
export function resetSyncState(leaderIndex: number | null = null): SyncState {
  return { breaches: 0, leaderIndex };
}

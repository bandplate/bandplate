// The loop region: where it is, and when playback jumps back to its start.
//
// Pure, and in its own module for the reason `mixer-tracks.ts` states in its
// own header: every decision the mixer makes lives somewhere a node-only
// vitest can reach, and the island is left with the Web Audio calls that
// carry the decision out.
//
// WHAT THIS LOOP IS NOT. A wrap is a seek on six or seven streaming media
// elements, and you wait for the slowest — 80-250ms on Chrome, more on
// Safari, which often re-requests bytes it already holds. So it JUMPS BACK.
// It is not a musical loop and nothing here may grow a beat grid, a bar
// count, or the word "seamless": a seam-free loop needs decoded buffers, and
// an eight-minute take decodes to about a gigabyte. What this is worth is
// "play those eight bars again", which is what someone with an instrument in
// their hands is actually asking for.

export interface LoopRegion {
  readonly startS: number;
  readonly endS: number;
}

export type LoopEdge = "start" | "end";

/**
 * The shortest region worth having.
 *
 * Below about this, the seam is most of what you hear and the control
 * becomes a stutter machine rather than a practice tool.
 */
export const MIN_LOOP_S = 1.5;

/** One arrow press. Fine enough to trim a bar line, coarse enough to get somewhere. */
export const LOOP_NUDGE_S = 0.25;

function clampTime(seconds: number, durationS: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  return Math.max(0, Math.min(durationS, seconds));
}

/** Whether the axis can hold a usable region at all. */
export function canLoop(durationS: number): boolean {
  return Number.isFinite(durationS) && durationS >= MIN_LOOP_S;
}

/**
 * Enforce the minimum by moving the edge the gesture did NOT place.
 *
 * `anchor` is the edge the member put down deliberately; the other one is
 * wherever their finger happened to be, so that is the one that gives.
 */
function widen(lo: number, hi: number, anchor: LoopEdge, durationS: number): LoopRegion {
  if (hi - lo >= MIN_LOOP_S) {
    return { startS: lo, endS: hi };
  }
  if (anchor === "start") {
    let endS = lo + MIN_LOOP_S;
    let startS = lo;
    // Ran off the end of the axis, so the anchor has to give after all —
    // there is nowhere else for the region to go.
    if (endS > durationS) {
      endS = durationS;
      startS = durationS - MIN_LOOP_S;
    }
    return { startS, endS };
  }
  let startS = hi - MIN_LOOP_S;
  let endS = hi;
  if (startS < 0) {
    startS = 0;
    endS = MIN_LOOP_S;
  }
  return { startS, endS };
}

/**
 * A region from a drag: two times in the order they were produced.
 *
 * `fromS` is where the gesture began, which is the edge the member chose;
 * `toS` is where the pointer is now.
 */
export function makeLoop(fromS: number, toS: number, durationS: number): LoopRegion | null {
  if (!canLoop(durationS)) {
    return null;
  }
  const a = clampTime(fromS, durationS);
  const b = clampTime(toS, durationS);
  return widen(Math.min(a, b), Math.max(a, b), a <= b ? "start" : "end", durationS);
}

/**
 * Put one edge at a time — the "loop from here" / "loop to here" path, which
 * is how this works one-handed on a phone propped against a music stand.
 */
export function setLoopEdge(
  region: LoopRegion | null,
  edge: LoopEdge,
  atS: number,
  durationS: number,
): LoopRegion | null {
  if (!canLoop(durationS)) {
    return null;
  }
  const at = clampTime(atS, durationS);
  if (!region) {
    // The FIRST mark opens a region against the far end of the axis rather
    // than waiting for its partner. Playback then keeps running, and keeps
    // wrapping, while you listen for the other edge — which is the whole
    // point of setting them one at a time.
    return edge === "start"
      ? widen(at, durationS, "start", durationS)
      : widen(0, at, "end", durationS);
  }
  const other = edge === "start" ? region.endS : region.startS;
  // The marks can be pressed in either order and may cross. Crossing means
  // the span between them; refusing the press would only make someone do it
  // again backwards.
  return widen(Math.min(at, other), Math.max(at, other), at <= other ? "start" : "end", durationS);
}

/**
 * Move one edge by a little — the keyboard path, and the one gesture that is
 * not a drag.
 *
 * Unlike a drag or a mark, a nudge holds the FAR edge still and stops this
 * one at the minimum. Pushing the far edge along instead would mean an arrow
 * key could shrink a region forever without it ever refusing.
 */
export function nudgeLoopEdge(
  region: LoopRegion | null,
  edge: LoopEdge,
  deltaS: number,
  durationS: number,
): LoopRegion | null {
  if (!region || !canLoop(durationS)) {
    return region;
  }
  if (edge === "start") {
    return {
      startS: Math.max(0, Math.min(region.endS - MIN_LOOP_S, region.startS + deltaS)),
      endS: region.endS,
    };
  }
  return {
    startS: region.startS,
    endS: Math.min(durationS, Math.max(region.startS + MIN_LOOP_S, region.endS + deltaS)),
  };
}

/**
 * Whether playback landing at `atS` will be caught by the loop.
 *
 * Anything before the end will reach it; anything at or past it has already
 * left. So clicking beyond the region plays on to the end of the take rather
 * than being yanked backwards — which is what a cycle does in every DAW, and
 * what you want the one time you jump ahead to check the ending.
 */
export function loopEngagedFrom(atS: number, region: LoopRegion | null): boolean {
  return region !== null && atS < region.endS;
}

export interface LoopWatch {
  positionS: number;
  region: LoopRegion | null;
  /** From `loopEngagedFrom`, decided when playback last landed somewhere. */
  engaged: boolean;
  /** The leader ran off the end of its own file. */
  ended?: boolean;
}

/**
 * Where playback should jump, or null to carry on.
 *
 * `ended` is not a tidy extra: with the region's end within a few hundred
 * milliseconds of the take's own, the element fires `ended` before the
 * position is ever read past `endS`, and the loop would simply stop.
 */
export function loopWrapTarget({
  positionS,
  region,
  engaged,
  ended = false,
}: LoopWatch): number | null {
  if (!region || !engaged) {
    return null;
  }
  return ended || positionS >= region.endS ? region.startS : null;
}

/** The region as fractions of the axis, for drawing it. Null when there is no axis yet. */
export function loopFractions(
  region: LoopRegion | null,
  durationS: number,
): { start: number; end: number } | null {
  if (!region || !(durationS > 0)) {
    return null;
  }
  return {
    start: Math.max(0, Math.min(1, region.startS / durationS)),
    end: Math.max(0, Math.min(1, region.endS / durationS)),
  };
}

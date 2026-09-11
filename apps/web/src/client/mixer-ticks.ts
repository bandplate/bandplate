// Where the timeline's gridlines go, and what they are labelled.
//
// One list drives both the ruler's numbers and the lines behind the lanes, so
// a label and its line cannot disagree — and each sits at its TRUE fraction of
// the take rather than being spaced evenly by the browser, which is how they
// drift apart the moment a take is not a round number of minutes long.

/**
 * Intervals a person counts in, coarsest last.
 *
 * Not a computed round number: 15s, 30s, a minute, two, five is how someone
 * reads a rehearsal recording, and an interval like 45s or 90s is arithmetic
 * nobody does while playing.
 */
const LADDER_S = [15, 30, 60, 120, 300, 600];

/**
 * About how many gridlines a timeline wants.
 *
 * Under six the grid stops helping you place a moment; over about twelve the
 * labels crowd and the lines start reading as texture rather than as a scale.
 */
const TARGET_TICKS = 9;

export interface Tick {
  /** Seconds from the start. */
  atS: number;
  /** 0..1 across the timeline — what both the label and the line are positioned by. */
  fraction: number;
  /** `m:ss`. */
  label: string;
  /** A whole minute. Drawn heavier, as a ruler's major ticks are. */
  major: boolean;
}

export function formatTick(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Pick the interval whose tick count lands closest to `TARGET_TICKS`, then
 * walk it across the take.
 *
 * The final tick is deliberately NOT forced to the take's end: a line at 4:12
 * of a 4:12 take sits on the edge of the frame and labels a moment nobody
 * navigates to. The grid stops at the last whole interval before it.
 */
export function timelineTicks(durationS: number): Tick[] {
  if (!Number.isFinite(durationS) || durationS <= 0) {
    return [];
  }
  let best = LADDER_S[0] ?? 15;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const step of LADDER_S) {
    const distance = Math.abs(durationS / step - TARGET_TICKS);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = step;
    }
  }

  const ticks: Tick[] = [];
  for (let atS = 0; atS < durationS; atS += best) {
    ticks.push({
      atS,
      fraction: atS / durationS,
      label: formatTick(atS),
      major: atS % 60 === 0,
    });
  }
  return ticks;
}

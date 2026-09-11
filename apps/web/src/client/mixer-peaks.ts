// Waveforms for a STACK of lanes, which is a different problem from a
// waveform for one player.
//
// `downsamplePeaks` (the player's) normalises per source, so the loudest bar
// of whatever it is drawing fills the rail. That is right for a bar showing
// one thing at a time: soloing a quiet stem should show its dynamics rather
// than a flat line near the floor.
//
// It is wrong — and not marginally — for lanes stacked on one timeline, which
// are read AGAINST EACH OTHER. Per-source normalisation makes a whisper-quiet
// room mic draw exactly as tall as the overheads, and it makes the mute and
// fader controls unreadable: you pull the loudest thing down and nothing in
// the picture changes. So the set gets one divisor.
import { downsamplePeaksAbsolute } from "./player-store.js";

/**
 * One lane's peaks file, or `null` where there is none.
 *
 * `null` is the ordinary case, not an error: per-stem peaks are a real slot
 * in the ingest contract, but whether a given stem HAS one depends on what
 * the bridge uploaded, and a lane without one draws a plain rail — the same
 * fallback the player already has for a 404.
 */
export type LanePeaks = readonly number[] | null;

/**
 * The single divisor for a set of lanes: the loudest bar anywhere in it.
 *
 * Returns 1 rather than 0 when every lane is silent or absent, so applying it
 * is always a safe no-op instead of a division by zero — the same call the
 * player's own normalisation makes for a silent source.
 */
export function sharedPeakScale(lanes: readonly (readonly number[])[]): number {
  let loudest = 0;
  for (const lane of lanes) {
    for (const bar of lane) {
      if (bar > loudest) {
        loudest = bar;
      }
    }
  }
  return loudest === 0 ? 1 : loudest;
}

/**
 * Bucket every lane to `bars` and scale them all by the same number, so a
 * lane that is genuinely quieter draws shorter.
 *
 * Lanes keep their positions: a `null` in goes to a `null` out rather than
 * being dropped, because the caller is rendering a fixed row per track and a
 * shifted lane would put one instrument's waveform on another's name.
 */
export function mixerLaneBars(lanes: readonly LanePeaks[], bars: number): (number[] | null)[] {
  const bucketed = lanes.map((lane) =>
    lane === null ? null : downsamplePeaksAbsolute([...lane], bars),
  );
  const scale = sharedPeakScale(bucketed.filter((lane): lane is number[] => lane !== null));
  return bucketed.map((lane) => lane?.map((bar) => bar / scale) ?? null);
}

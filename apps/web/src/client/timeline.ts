// The arithmetic every timeline in the app does the same way: the shell
// player's scrub, the recorder's review waveform, the mixer's lanes. Pulled
// out of the three islands so it is written once and has a test; each island
// still reads its own `getBoundingClientRect()` and `audio.currentTime`, and
// hands the numbers here.

/**
 * `m:ss`, FLOORED. A live clock reading `currentTime`: rounding would show
 * 1:00 from 0:59.5 onward, half a second before the minute.
 *
 * Not `@bandplate/i18n`'s `formatDuration`, which rounds because it renders
 * a stored `durationMs`, where the nearest second is the honest answer. Nor
 * the recorder's `formatElapsed`, which grows an hours field for a long take.
 * Digits and a colon in every language, so no locale.
 */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Where across a box a pointer is, 0..1, clamped to the box. `null` for a box
 * with no width (collapsed, or not laid out yet), where the division would
 * seek to NaN.
 */
export function fractionAt(clientX: number, box: { left: number; width: number }): number | null {
  if (box.width <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
}

/**
 * How many waveform bars a measured width has room for: one per `pitch`
 * pixels, between `min` and `max`. `null` for a width of zero, which is a box
 * not laid out yet rather than a box with room for the minimum.
 *
 * Derived rather than fixed because the bars are `flex: 1 1 0`: a fixed count
 * that looks right on a phone becomes slabs on a desktop.
 */
export function barCountForWidth(
  width: number,
  bounds: { pitch: number; min: number; max: number },
): number | null {
  if (width <= 0) {
    return null;
  }
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(width / bounds.pitch)));
}

/**
 * How far through the take the playhead is. Zero while there is no usable
 * duration: before metadata, and for a WebM whose header has none (Chrome's
 * MediaRecorder writes those, and `<audio>` reports `Infinity`).
 *
 * Not clamped: a caller that draws past the end with it decides that itself.
 */
export function playedFraction(position: number, duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? position / duration : 0;
}

/** `audio.duration`, with NaN (no metadata) and Infinity (no header) read as "none yet". */
export function finiteDuration(duration: number): number {
  return Number.isFinite(duration) ? duration : 0;
}

/**
 * Which ends of a scrolling list have more past them, for the fades that say
 * so. A pixel of slack either way, because a list that exactly fits can
 * still report a fractional remainder.
 */
export function scrollFades(box: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): {
  above: boolean;
  below: boolean;
} {
  return {
    above: box.scrollTop > 1,
    below: box.scrollTop + box.clientHeight < box.scrollHeight - 1,
  };
}

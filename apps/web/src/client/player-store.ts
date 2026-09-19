// The persistent player's state — nanostores (~1KB), not a framework
// store, specifically so both `.astro` pages (plain markup + a data-*
// attribute contract, no hydration of their own) and the one Preact
// island (`Player.tsx`) can share it. See Player.tsx's header comment for
// the full mechanism: this module only holds the state, never touches the
// DOM.
//
// Browser-only despite living in a plain .ts module with no Node/DOM
// dependency of its own (nanostores itself is isomorphic) — nothing here
// requires that, it's just never imported from server code.
import { atom } from "nanostores";
import type { PlayQueue } from "./player-queue.js";

/** A play/solo control's persistent identity, in one place — every element wired up to the player (TakeRow's leading slot, the take-detail hero, the stems drawer) carries these as `data-*` attributes with these exact names, read by `Player.tsx`'s delegated click handler. */
export const AUDIO_SOURCE_ATTR = "data-audio-source";

export interface PlayerTrack {
  takeId: string;
  /** Song title (or a fallback label) — never changes across a source switch on the same take. */
  title: string;
  /** Event/date context, or the take's own label. Empty string when there is none. */
  subtitle: string;
  /** The asset id of the currently selected source (the master, or one stem). */
  sourceAssetId: string;
  /**
   * Which KIND of source is playing. This used to be inferred by comparing a
   * display label against the literal `"Master"`, which made an English word
   * load-bearing: the player decided how to phrase its announcement, and which
   * name to show on the switcher chip, by string-matching copy. Translate the
   * copy and the announcement would silently start naming the master as if it
   * were a stem. The kind is the fact; the label is presentation.
   */
  sourceKind: "master" | "stem";
  /**
   * The instrument a stem isolates — `""` for a master, whose name the player
   * supplies itself so the word lives in exactly one place. Announced
   * alongside the title on every source switch, since that IS a track change
   * from a listening (and accessibility) standpoint.
   */
  sourceName: string;
}

/** `null` when nothing has ever been played this session. */
export const currentTrack = atom<PlayerTrack | null>(null);
export const isPlaying = atom<boolean>(false);
/** What plays after the current take — see `player-queue.ts`. `null` until something plays. */
export const playQueue = atom<PlayQueue | null>(null);

export function audioUrl(assetId: string): string {
  return `/api/assets/${assetId}/audio`;
}

/** The waveform describing ONE source — keyed by the audio asset, not by the peaks row, so a caller needs nothing it does not already hold. 404s until something computes peaks; see `peaksStorageKey`. */
export function peaksUrl(assetId: string): string {
  return `/api/assets/${assetId}/peaks`;
}

/** What a take can be heard as. Fetched when the player's source switch is opened, not rendered into every row — see the route's comment. */
export function sourcesUrl(takeId: string): string {
  return `/api/takes/${takeId}/sources`;
}

export interface PlayerSource {
  assetId: string;
  kind: "master" | "stem";
  /** "Master", or the instrument's label. */
  label: string;
  /** An `INSTRUMENT_GLYPHS` key, or null for the master. */
  icon: string | null;
}

/**
 * What a peaks value of full amplitude is, per the ingest contract: the file
 * holds integers in -128..127, not the 0..1 fractions the bars are drawn
 * from.
 */
export const PEAK_FULL_SCALE = 127;

/**
 * Reduce a peaks file to the bar count the drawing has room for, taking the
 * MAX of each bucket rather than the mean: a waveform is about where the loud
 * parts are, and averaging flattens exactly the transients that make one
 * recognisable.
 *
 * Input is the contract's -128..127 integers; output is each bar's ABSOLUTE
 * fraction of full scale. Reading the integers AS fractions — which is what
 * this did — clamped every bar to 1 and drew a solid block of full-height
 * bars on every take that had a waveform at all.
 *
 * Absolute, and normalised separately, because the two readers want different
 * normalisation and only one of them is the player. See `normalisePeaks`.
 */
export function downsamplePeaksAbsolute(peaks: number[], bars: number): number[] {
  if (peaks.length === 0) {
    return [];
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = Math.floor((i * peaks.length) / bars);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / bars));
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      // Magnitude, not signed value: the contract folds each bucket's minimum
      // and maximum into one array by alternating sign, so the sign says
      // nothing a bar height can use — and ignoring it threw away half the
      // samples, since only the positive ones ever beat a max starting at 0.
      const v = Math.abs(peaks[j] ?? 0);
      if (v > max) {
        max = v;
      }
    }
    // Clamped against the contract's range rather than trusted, since this is
    // a file from object storage.
    out.push(Math.max(0, Math.min(1, max / PEAK_FULL_SCALE)));
  }
  return out;
}

/**
 * Scale bars so the loudest one fills the height.
 *
 * A waveform is a picture of shape, not a calibrated meter: the stored values
 * are honest absolute amplitudes, and a rehearsal mixed with headroom peaks
 * around half of full scale, so drawing them absolutely wastes half the rail
 * and squashes the shape into a band.
 *
 * PER SOURCE, which is right for the player — it draws one source at a time,
 * and soloing a quiet stem should show its dynamics rather than a flat line
 * near the floor. It is NOT right for a stack of mixer lanes read against
 * each other; that case divides the whole set by one number instead.
 */
export function normalisePeaks(bars: number[]): number[] {
  let loudest = 0;
  for (const bar of bars) {
    if (bar > loudest) {
      loudest = bar;
    }
  }
  // A silent source has nothing to scale to; leaving it flat at zero beats
  // dividing by zero and beats amplifying noise into a full-height picture.
  if (loudest === 0) {
    return bars;
  }
  return bars.map((bar) => bar / loudest);
}

/** The player's own composition of the two: bucket, then scale to this source. */
export function downsamplePeaks(peaks: number[], bars: number): number[] {
  return normalisePeaks(downsamplePeaksAbsolute(peaks, bars));
}

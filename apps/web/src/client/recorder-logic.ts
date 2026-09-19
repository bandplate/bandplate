// The recorder's decisions, with no microphone in sight.
//
// `Recorder.tsx` owns the MediaStream, the MediaRecorder, the AudioContext, the
// wake lock and IndexedDB. Everything that can be decided without them — which
// container to ask for, what a phase transition means, what the timer says,
// how loud the ring is, which songs match a search — is here, where a node
// test can hold it to account.

/**
 * What to ask MediaRecorder for, best first.
 *
 * AAC in MP4 first because it is the one format every browser in the band can
 * PLAY: a take recorded on one member's Android has to play on another's
 * iPhone. Opus in WebM second (Firefox has no MP4 recorder; older Chrome
 * neither). Only these two are stored — see `shapeForMime`.
 */
export const RECORDER_MIME_PREFERENCE = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export function pickRecorderMime(isTypeSupported: (mime: string) => boolean): string | null {
  for (const mime of RECORDER_MIME_PREFERENCE) {
    if (isTypeSupported(mime)) {
      return mime;
    }
  }
  return null;
}

export type RecordedFormat = "webm" | "m4a";

export interface RecordedShape {
  /** `assets.format`. */
  format: RecordedFormat;
  /** What the presigned PUT signs and what the bucket serves it back as. */
  contentType: string;
  extension: string;
}

function baseType(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

export function shapeForMime(mime: string): RecordedShape | null {
  switch (baseType(mime)) {
    case "audio/webm":
      return { format: "webm", contentType: "audio/webm", extension: "webm" };
    case "audio/mp4":
      return { format: "m4a", contentType: "audio/mp4", extension: "m4a" };
    default:
      return null;
  }
}

/**
 * Chrome's MediaRecorder writes a WebM with no duration in its header, so an
 * `<audio>` reports `Infinity` and the player cannot seek it. The recorder
 * writes the measured duration in before the blob is kept.
 */
export function needsDurationFix(mime: string): boolean {
  return baseType(mime) === "audio/webm";
}

export type RecorderPhase =
  /** Step 1: choose the song. */
  | "pick"
  /** Song known (it came with the link), waiting for the press that starts. */
  | "armed"
  /** Asking for the microphone. */
  | "starting"
  | "recording"
  /** × was pressed; still recording until the member says throw it away. */
  | "confirm-discard"
  /** Stop pressed; the recorder is flushing its last chunk. */
  | "finishing"
  | "review"
  /** Writing it to IndexedDB. */
  | "saving"
  | "error";

export type RecorderError = "denied" | "no-mic" | "unsupported" | "save-failed";

export interface RecorderState {
  phase: RecorderPhase;
  songId: string | null;
  /** A monotonic clock reading (`performance.now()`), not a wall-clock time. */
  startedAt: number | null;
  elapsedMs: number;
  error: RecorderError | null;
}

export type RecorderEvent =
  | { type: "select"; songId: string }
  | { type: "change-song" }
  | { type: "start" }
  | { type: "started"; at: number }
  | { type: "tick"; now: number }
  | { type: "cancel" }
  | { type: "keep-going" }
  | { type: "discard" }
  | { type: "stop"; now: number }
  | { type: "finished" }
  | { type: "save" }
  | { type: "failed"; error: RecorderError };

export function initialRecorderState(preselectedSongId: string | null): RecorderState {
  return {
    phase: preselectedSongId ? "armed" : "pick",
    songId: preselectedSongId,
    startedAt: null,
    elapsedMs: 0,
    error: null,
  };
}

const CAN_START: readonly RecorderPhase[] = ["pick", "armed", "review", "error"];

/**
 * One transition. Anything that does not belong to the current phase returns
 * the SAME state object, so a stray tick or a double-tapped stop is a no-op
 * rather than a corrupted clock.
 */
export function reduceRecorder(state: RecorderState, event: RecorderEvent): RecorderState {
  switch (event.type) {
    case "select":
      return state.phase === "pick" ? { ...state, songId: event.songId } : state;
    case "change-song":
      return state.phase === "armed" || state.phase === "error"
        ? { ...state, phase: "pick", error: null }
        : state;
    case "start":
      if (!state.songId || !CAN_START.includes(state.phase)) {
        return state;
      }
      return { ...state, phase: "starting", startedAt: null, elapsedMs: 0, error: null };
    case "started":
      return state.phase === "starting"
        ? { ...state, phase: "recording", startedAt: event.at, elapsedMs: 0 }
        : state;
    case "tick":
      if (
        (state.phase !== "recording" && state.phase !== "confirm-discard") ||
        state.startedAt === null
      ) {
        return state;
      }
      return { ...state, elapsedMs: Math.max(0, event.now - state.startedAt) };
    case "cancel":
      return state.phase === "recording" ? { ...state, phase: "confirm-discard" } : state;
    case "keep-going":
      return state.phase === "confirm-discard" ? { ...state, phase: "recording" } : state;
    case "discard":
      return state.phase === "confirm-discard"
        ? { ...state, phase: "armed", startedAt: null, elapsedMs: 0 }
        : state;
    case "stop":
      if (
        (state.phase !== "recording" && state.phase !== "confirm-discard") ||
        state.startedAt === null
      ) {
        return state;
      }
      return { ...state, phase: "finishing", elapsedMs: Math.max(0, event.now - state.startedAt) };
    case "finished":
      return state.phase === "finishing" ? { ...state, phase: "review" } : state;
    case "save":
      return state.phase === "review" ? { ...state, phase: "saving", error: null } : state;
    case "failed":
      if (state.phase === "saving") {
        return { ...state, phase: "review", error: event.error };
      }
      return { ...state, phase: "error", error: event.error };
  }
}

/** `0:42`, `12:05`, `1:02:03`. Rendered in Chivo with tabular figures, never mono. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * How far the ring around the stop button reaches, 0..1, from one analyser
 * frame (`getByteTimeDomainData`, silence = 128). RMS, then a square-root
 * curve: a phone in a rehearsal room and a voice memo in a tram both sit far
 * below full scale, and a linear ring would barely move for either.
 */
export function levelFromTimeDomain(samples: Uint8Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    const v = (sample - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  // A 1.2 gain past the square root, so a loud room fills the ring rather
  // than stopping a hair short of it (255 is 127/128 of full scale, not 1).
  return Math.min(1, Math.sqrt(rms) * 1.2);
}

/**
 * The longest recording the review screen draws a waveform for. Decoding in
 * the browser holds the whole take as 32-bit PCM (an hour of stereo 48 kHz is
 * over a gigabyte), which is how a phone tab dies. Past this the review shows
 * no picture, and play still works.
 */
export const WAVEFORM_DECODE_LIMIT_MS = 10 * 60_000;

export function shouldDrawWaveform(durationMs: number): boolean {
  return durationMs <= WAVEFORM_DECODE_LIMIT_MS;
}

/**
 * The review screen's waveform: `bars` peaks, the loudest scaled to 1. Same
 * shape as the player's `downsamplePeaks`, but over a decoded channel
 * (millions of samples) rather than a stored peaks file, so it walks the
 * Float32Array in place instead of copying it into a number[] first.
 */
export function waveformBars(samples: Float32Array, bars: number): number[] {
  if (bars <= 0 || samples.length === 0) {
    return [];
  }
  const out: number[] = [];
  let loudest = 0;
  for (let i = 0; i < bars; i++) {
    const start = Math.floor((i * samples.length) / bars);
    const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / bars));
    let peak = 0;
    for (let j = start; j < end && j < samples.length; j++) {
      const v = Math.abs(samples[j] ?? 0);
      if (v > peak) {
        peak = v;
      }
    }
    out.push(peak);
    if (peak > loudest) {
      loudest = peak;
    }
  }
  return loudest > 0 ? out.map((v) => v / loudest) : out;
}

export interface SongOption {
  id: string;
  title: string;
  slug: string;
}

/** Lowercase, no diacritics — "Čoudy" is found by typing "coudy". */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** The picker's search. Keeps the caller's order. */
export function filterSongs(songs: SongOption[], query: string): SongOption[] {
  const needle = foldForSearch(query);
  if (!needle) {
    return songs;
  }
  return songs.filter((song) => foldForSearch(song.title).includes(needle));
}

export interface PickerGroup {
  /** `recent` and `all` carry a heading; `matches` is a search's one flat list. */
  kind: "recent" | "all" | "matches";
  songs: SongOption[];
}

/**
 * What the picker shows. With no search: the songs the band played most
 * recently (in `recentIds` order), then the whole library, in which the recent
 * ones appear again, because "all songs" that skipped five of them would not be
 * all of them. With a search: one list of matches, which may be empty.
 */
export function pickerGroups(
  songs: SongOption[],
  recentIds: string[],
  query: string,
): PickerGroup[] {
  if (foldForSearch(query)) {
    return [{ kind: "matches", songs: filterSongs(songs, query) }];
  }
  if (songs.length === 0) {
    return [];
  }
  const byId = new Map(songs.map((song) => [song.id, song]));
  const recent = recentIds.flatMap((id) => {
    const song = byId.get(id);
    return song ? [song] : [];
  });
  return recent.length > 0
    ? [
        { kind: "recent", songs: recent },
        { kind: "all", songs },
      ]
    : [{ kind: "all", songs }];
}

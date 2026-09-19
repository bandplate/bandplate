// The upload panel's decisions, with no DOM in sight.
//
// Split out for the same reason `vote-favorite-actions.ts` is: what a file
// becomes, and what a row does next, are rules worth testing directly rather
// than through a rendered component. `AssetUploader.tsx` owns the bytes, the
// progress events and the markup; everything here is a pure function.

export type AssetFormat = "opus" | "mp3" | "flac" | "wav" | "webm" | "m4a";
export type AssetTier = "lossy" | "lossless";
export type AssetKind = "master" | "stem";

export interface AudioShape {
  format: AssetFormat;
  tier: AssetTier;
}

/**
 * Tier follows FORMAT, not a choice.
 *
 * flac and wav are lossless by definition; mp3 and opus are not. Asking a
 * member which one a file is would be asking them to answer a question the
 * file already answers, and getting it wrong puts a 40 MB flac in the slot the
 * player reaches for first.
 */
const SHAPE_BY_FORMAT: Record<AssetFormat, AssetTier> = {
  flac: "lossless",
  wav: "lossless",
  mp3: "lossy",
  opus: "lossy",
  webm: "lossy",
  m4a: "lossy",
};

const EXTENSIONS: Record<string, AssetFormat> = {
  flac: "flac",
  wav: "wav",
  wave: "wav",
  mp3: "mp3",
  opus: "opus",
  // A `.ogg` from a Reaper render is Vorbis or Opus in an Ogg container, and
  // the bucket stores both under `audio/ogg` — which is exactly what the
  // `opus` format maps to. Treating it as opus is the honest available answer.
  ogg: "opus",
  webm: "webm",
  m4a: "m4a",
};

const MIME_TYPES: Record<string, AssetFormat> = {
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "opus",
  "audio/opus": "opus",
  // What a phone's voice recorder or the browser's MediaRecorder hands over.
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
};

/**
 * What a picked file is, or `null` if it is not audio this app stores.
 *
 * Extension first, MIME second. The browser's `file.type` is unreliable in
 * exactly the case that matters here — a `.flac` off a Linux box or an SMB
 * share often arrives as `""` or `application/octet-stream` — while the
 * extension is what the person who rendered it chose deliberately.
 */
export function readAudioShape(name: string, mimeType: string): AudioShape | null {
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  const format = EXTENSIONS[extension] ?? MIME_TYPES[mimeType.toLowerCase()];
  if (!format) {
    return null;
  }
  return { format, tier: SHAPE_BY_FORMAT[format] };
}

/**
 * What a newly picked file should be, before anyone touches the controls.
 *
 * The first file on an empty take is the master — that is what people upload
 * first and nearly always what a lone file is. Once a master exists, anything
 * else is a stem, because a second master would only collide with the first.
 */
export function defaultKind(takeHasMaster: boolean): AssetKind {
  return takeHasMaster ? "stem" : "master";
}

export type UploadPhase =
  /** Picked, nothing done yet. */
  | "queued"
  /** Reading its length off an `<audio>` element, before any bytes move. */
  | "measuring"
  /** Asking the server for a slot and a URL. */
  | "declaring"
  /** Bytes moving to the bucket. */
  | "uploading"
  /** Bytes done; asking the server to confirm the object arrived whole. */
  | "verifying"
  | "ready"
  /** Something is already in this slot; a person has to say replace or skip. */
  | "slot-occupied"
  | "failed";

export interface UploadItem {
  id: string;
  fileName: string;
  bytes: number;
  format: AssetFormat;
  tier: AssetTier;
  kind: AssetKind;
  instrumentId: string | null;
  phase: UploadPhase;
  /** 0–100 while `uploading`. */
  progress: number;
  durationMs: number | null;
  assetId: string | null;
  /** Shown on `failed` and `slot-occupied`. */
  message: string | null;
  /** What is already in the slot, for the replace prompt. */
  occupiedBy: { format: string; tier: string; bytes: number } | null;
}

/** Whether this item still needs a person before anything more can happen. */
export function needsDecision(item: UploadItem): boolean {
  return item.phase === "slot-occupied" || item.phase === "failed";
}

/** Whether the queue is finished — nothing moving, nothing waiting on anyone. */
export function isSettled(items: UploadItem[]): boolean {
  return items.every((i) => i.phase === "ready" || needsDecision(i));
}

/**
 * Whether an item is allowed to start.
 *
 * A stem with no instrument chosen is not ready to send: the server would 422
 * it, and a round trip is a worse way to say "pick one" than not starting.
 */
export function canStart(item: UploadItem): boolean {
  if (item.kind === "stem" && !item.instrumentId) {
    return false;
  }
  return item.phase === "queued" || item.phase === "slot-occupied" || item.phase === "failed";
}

/**
 * Why an item cannot start yet, or null. Separate from `canStart` so the row
 * can say the reason rather than just sitting there disabled.
 */
export function blockedReason(item: UploadItem): string | null {
  if (item.kind === "stem" && !item.instrumentId) {
    return "Choose which instrument this is.";
  }
  return null;
}

export function makeItem(
  id: string,
  fileName: string,
  bytes: number,
  shape: AudioShape,
  kind: AssetKind,
): UploadItem {
  return {
    id,
    fileName,
    bytes,
    format: shape.format,
    tier: shape.tier,
    kind,
    instrumentId: null,
    phase: "queued",
    progress: 0,
    durationMs: null,
    assetId: null,
    message: null,
    occupiedBy: null,
  };
}

export type UploadEvent =
  | { type: "measured"; durationMs: number | null }
  | { type: "declaring" }
  | { type: "declared"; assetId: string }
  | { type: "progress"; progress: number }
  | { type: "verifying" }
  | { type: "ready" }
  | { type: "occupied"; existing: { format: string; tier: string; bytes: number } }
  | { type: "failed"; message: string }
  | { type: "kind"; kind: AssetKind }
  | { type: "instrument"; instrumentId: string | null }
  | { type: "retry" };

/**
 * One item's transition. A reducer rather than scattered `setState` calls so
 * the illegal moves are visible in one place — notably that `retry` clears the
 * message and the occupancy, since a row that still showed "already there"
 * while re-uploading would be lying.
 */
export function reduceItem(item: UploadItem, event: UploadEvent): UploadItem {
  switch (event.type) {
    case "measured":
      return { ...item, phase: "declaring", durationMs: event.durationMs };
    case "declaring":
      return { ...item, phase: "declaring" };
    case "declared":
      return { ...item, phase: "uploading", assetId: event.assetId, progress: 0 };
    case "progress":
      return { ...item, phase: "uploading", progress: event.progress };
    case "verifying":
      return { ...item, phase: "verifying", progress: 100 };
    case "ready":
      return { ...item, phase: "ready", progress: 100, message: null, occupiedBy: null };
    case "occupied":
      return { ...item, phase: "slot-occupied", occupiedBy: event.existing, message: null };
    case "failed":
      return { ...item, phase: "failed", message: event.message };
    case "kind":
      // Switching to master drops the instrument: a master has none, and
      // sending one is a 422.
      return {
        ...item,
        kind: event.kind,
        instrumentId: event.kind === "master" ? null : item.instrumentId,
      };
    case "instrument":
      return { ...item, instrumentId: event.instrumentId };
    case "retry":
      return { ...item, phase: "queued", progress: 0, message: null, occupiedBy: null };
  }
}

// Deterministic object-storage key layout for take assets. Centralised
// here (rather than inlined at each call site — the seed script, the audio
// endpoint's callers, a future ingest pipeline) so every producer and
// consumer of a storage key agrees on the exact shape, and a retried
// upload overwrites the same key instead of orphaning a new one.
//
//   takes/{takeId}/master/{tier}.{ext}
//   takes/{takeId}/stems/{instrumentSlug}/{tier}.{ext}
//   takes/{takeId}/peaks/master.json
//   takes/{takeId}/peaks/stems/{instrumentSlug}.json
//
// Peaks are PER AUDIO ASSET, not per take. They used to be one
// `takes/{takeId}/peaks.json` — which silently decided that soloing a stem
// would show you the master's waveform, since there was only ever one
// shape to draw. The player switches source while holding the playhead,
// so the picture has to switch with it. Changed while nothing had written
// a peaks file yet; after the ingest bridge has run over an archive this
// is a re-render of every take rather than a one-line change.

export type StorageTier = "lossy" | "lossless";

export function masterStorageKey(takeId: string, tier: StorageTier, ext: string): string {
  return `takes/${takeId}/master/${tier}.${ext}`;
}

export function stemStorageKey(
  takeId: string,
  instrumentSlug: string,
  tier: StorageTier,
  ext: string,
): string {
  return `takes/${takeId}/stems/${instrumentSlug}/${tier}.${ext}`;
}

/**
 * Where the waveform for one audio asset lives. `instrumentSlug` omitted
 * (or undefined) is the take's master; passing one is that stem's own
 * shape. Mirrors the audio keys above deliberately, so a prefix delete of
 * `takes/{takeId}/` still takes the peaks with it.
 */
export function peaksStorageKey(takeId: string, instrumentSlug?: string): string {
  return instrumentSlug
    ? `takes/${takeId}/peaks/stems/${instrumentSlug}.json`
    : `takes/${takeId}/peaks/master.json`;
}

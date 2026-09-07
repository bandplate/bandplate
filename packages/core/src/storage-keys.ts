// Deterministic object-storage key layout for take assets. Centralised
// here (rather than inlined at each call site — the seed script, the audio
// endpoint's callers, a future ingest pipeline) so every producer and
// consumer of a storage key agrees on the exact shape, and a retried
// upload overwrites the same key instead of orphaning a new one.
//
//   takes/{takeId}/master/{tier}.{ext}
//   takes/{takeId}/stems/{instrumentSlug}/{tier}.{ext}
//   takes/{takeId}/peaks.json

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

export function peaksStorageKey(takeId: string): string {
  return `takes/${takeId}/peaks.json`;
}

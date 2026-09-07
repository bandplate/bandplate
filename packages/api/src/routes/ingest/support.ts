// Small ingest-specific helpers shared across the route handlers. Web
// Crypto/`btoa` only — no `node:buffer` — so this stays fine to run on
// Workers in increment 7 like the rest of `packages/api`.
import type { assetsRepo } from "@bandlib/db";

type AssetFormat = assetsRepo.AssetFormat;

/** MIME type for each on-disk asset format — used both for the stored
 * `assets.contentType` column and the `Content-Type` header the presigned
 * PUT URL enforces. */
export function contentTypeForFormat(format: AssetFormat): string {
  switch (format) {
    case "opus":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "json":
      return "application/json";
  }
}

/**
 * Converts a lowercase-hex SHA-256 digest (the shape the ingest contract's
 * `sha256` field uses) to standard base64 — the encoding S3's
 * `x-amz-checksum-sha256` header and `AwsClient`'s checksum signing expect
 * (NOT base64url; see `@bandlib/core`'s `crypto.ts`, which only has a
 * base64url encoder for token hashing, a different use case).
 */
export function hexSha256ToBase64(hex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`hexSha256ToBase64: not a 64-char hex string: ${hex}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** Parses an ISO-8601 datetime-with-offset string (already zod-validated) to epoch ms. */
export function parseIsoToEpochMs(value: string): number {
  return new Date(value).getTime();
}

/** Presigned PUT URLs live 1 hour — contract v1 §4 "Expiry". */
export const UPLOAD_URL_TTL_SECONDS = 60 * 60;

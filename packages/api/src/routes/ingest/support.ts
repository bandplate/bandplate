// The one ingest-specific helper left here. `contentTypeForFormat`,
// `hexSha256ToBase64` and `UPLOAD_URL_TTL_SECONDS` moved to
// `@bandplate/core`'s `services/assets.ts` once a second front door needed
// them; this one stays because parsing an ISO-8601 string with an offset is
// the bridge's problem alone — the browser posts `date`/`datetime-local`
// values, a different shape.

/** Parses an ISO-8601 datetime-with-offset string (already zod-validated) to epoch ms. */
export function parseIsoToEpochMs(value: string): number {
  return new Date(value).getTime();
}

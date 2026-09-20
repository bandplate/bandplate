// Request-body schemas for the ingest API — contract v1
// (`docs/ingest-contract-v1.md`). These are the SINGLE source of truth for
// both request validation (each route's `.safeParse`) and the OpenAPI
// document (`openapi.ts`'s `zodToJsonSchema` walks these same objects) —
// the contract's own promise ("generated from the same Zod schemas that
// validate requests") would be a lie if the two ever drifted apart.
import { STASH_CLIENT_REF_PREFIX } from "@bandplate/core";
import { z } from "zod";

/**
 * A bridge's own idempotency key — and never one of the browser's.
 *
 * The stash writes its takes' `client_ref` behind `stash:`
 * (`STASH_CLIENT_REF_PREFIX`) so the two namespaces cannot collide. Nothing
 * ENFORCED that until here: a bridge posting `clientRef: "stash:local-9"`
 * would have matched a member's private recording on the way in, and
 * `ingest/takes.ts` asserts the take it finds by clientRef has a song, which
 * a stash recording need not. So the prefix is refused at the door, where the
 * assertion can rest on it.
 */
const bridgeClientRef = z
  .string()
  .trim()
  .min(1)
  .refine((ref) => !ref.startsWith(STASH_CLIENT_REF_PREFIX), {
    message: `must not start with "${STASH_CLIENT_REF_PREFIX}" — that prefix belongs to members' own recordings`,
  });

/** ISO-8601 timestamp WITH a numeric offset — contract v1 §4: "the offset is
 * how it knows what you meant." `Z` counts as an offset (zod's `offset: true`
 * accepts it). */
export const isoDatetimeWithOffset = z
  .string()
  .datetime({ offset: true, message: "must be an ISO-8601 timestamp with a UTC offset" });

export const eventKindSchema = z.enum(["rehearsal", "concert", "session"]);

export const createEventSchema = z.object({
  clientRef: bridgeClientRef,
  /**
   * Apply this body's descriptive fields to an event that already exists.
   *
   * Off by default, so a re-post stays the pure lookup contract v1 §3
   * describes. On, it is a correction: the bridge's own record is the one a
   * person edits, and without this a venue fixed there could never reach the
   * library, since every field below is read only when the row is created.
   *
   * Never `clientRef` -- which row the bridge writes to is identity, not
   * metadata (see `eventsRepo.setClientRef`).
   */
  updateMetadata: z.boolean().default(false),
  kind: eventKindSchema,
  heldAt: isoDatetimeWithOffset,
  venue: z.string().trim().min(1).max(500).nullish(),
  notes: z.string().trim().min(1).max(5000).nullish(),
  title: z.string().trim().min(1).max(500).nullish(),
});
export type CreateEventBody = z.infer<typeof createEventSchema>;

export const assetTierSchema = z.enum(["lossy", "lossless"]);
export const audioFormatSchema = z.enum(["opus", "mp3", "flac", "wav"]);
export const instrumentSlugSchema = z.string().trim().min(1).max(100);

const assetCommonFields = {
  tier: assetTierSchema,
  bytes: z.number().int().positive(),
  sha256: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, "must be a 64-character hex SHA-256 digest")
    .nullish(),
  durationMs: z.number().int().nonnegative().nullish(),
  sampleRate: z.number().int().positive().nullish(),
  channels: z.number().int().positive().nullish(),
};

export const masterAssetSchema = z.object({
  kind: z.literal("master"),
  format: audioFormatSchema,
  ...assetCommonFields,
});

export const stemAssetSchema = z.object({
  kind: z.literal("stem"),
  instrument: instrumentSlugSchema,
  format: audioFormatSchema,
  ...assetCommonFields,
});

export const peaksAssetSchema = z.object({
  kind: z.literal("peaks"),
  format: z.literal("json"),
  // Which source this waveform describes: absent for the take's master,
  // a stem's slug for that stem. `peaksStorageKey` and `/assets/:id/peaks`
  // have always been per-source; without this field ingest had no way to say
  // so, and a second peaks asset collided with the master's on one key.
  instrument: instrumentSlugSchema.nullish(),
  tier: assetTierSchema.default("lossy"),
  bytes: z.number().int().positive(),
  sha256: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, "must be a 64-character hex SHA-256 digest")
    .nullish(),
});

export const assetInputSchema = z.discriminatedUnion("kind", [
  masterAssetSchema,
  stemAssetSchema,
  peaksAssetSchema,
]);
export type AssetInput = z.infer<typeof assetInputSchema>;

export const songRefSchema = z.object({
  externalRef: z.string().trim().min(1).nullish(),
  title: z.string().trim().min(1).max(500),
  createIfMissing: z.boolean().default(false),
});

export const createTakeSchema = z.object({
  clientRef: bridgeClientRef,
  eventClientRef: z.string().trim().min(1),
  song: songRefSchema,
  recordedAt: isoDatetimeWithOffset,
  durationMs: z.number().int().nonnegative().nullish(),
  label: z.string().trim().min(1).max(500).nullish(),
  instruments: z.array(instrumentSlugSchema).default([]),
  /**
   * Let an unrecognised slug become a STUB instrument instead of failing.
   *
   * Opt-in and default false, mirroring `song.createIfMissing` exactly — a
   * bridge that ships a mapping file keeps its typo protection, and one that
   * does not can ask for the slugs it declares to be created. What arrives is
   * a stub: the slug, a label taken from it, and nothing else, flagged in the
   * admin table until a human finishes it.
   */
  createMissingInstruments: z.boolean().default(false),
  assets: z.array(assetInputSchema).min(1),
});
export type CreateTakeBody = z.infer<typeof createTakeSchema>;

export const commitTakeSchema = z.object({
  publish: z.boolean().default(true),
});
export type CommitTakeBody = z.infer<typeof commitTakeSchema>;

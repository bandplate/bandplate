// Request-body schemas for the ingest API — contract v1
// (`docs/ingest-contract-v1.md`). These are the SINGLE source of truth for
// both request validation (each route's `.safeParse`) and the OpenAPI
// document (`openapi.ts`'s `zodToJsonSchema` walks these same objects) —
// the contract's own promise ("generated from the same Zod schemas that
// validate requests") would be a lie if the two ever drifted apart.
import { z } from "zod";

/** ISO-8601 timestamp WITH a numeric offset — contract v1 §4: "the offset is
 * how it knows what you meant." `Z` counts as an offset (zod's `offset: true`
 * accepts it). */
export const isoDatetimeWithOffset = z
  .string()
  .datetime({ offset: true, message: "must be an ISO-8601 timestamp with a UTC offset" });

export const eventKindSchema = z.enum(["rehearsal", "concert", "session"]);

export const createEventSchema = z.object({
  clientRef: z.string().trim().min(1),
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
  clientRef: z.string().trim().min(1),
  eventClientRef: z.string().trim().min(1),
  song: songRefSchema,
  recordedAt: isoDatetimeWithOffset,
  durationMs: z.number().int().nonnegative().nullish(),
  label: z.string().trim().min(1).max(500).nullish(),
  instruments: z.array(instrumentSlugSchema).default([]),
  assets: z.array(assetInputSchema).min(1),
});
export type CreateTakeBody = z.infer<typeof createTakeSchema>;

export const commitTakeSchema = z.object({
  publish: z.boolean().default(true),
});
export type CommitTakeBody = z.infer<typeof commitTakeSchema>;

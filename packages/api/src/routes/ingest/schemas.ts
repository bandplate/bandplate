// Request-body schemas for the ingest API — contract v1
// (`docs/ingest-contract-v1.md`). These are the SINGLE source of truth for
// both request validation (each route's `.safeParse`) and the OpenAPI
// document (`openapi.ts`'s `zodToJsonSchema` walks these same objects) —
// the contract's own promise ("generated from the same Zod schemas that
// validate requests") would be a lie if the two ever drifted apart.
import { STASH_CLIENT_REF_PREFIX } from "@bandplate/core";
import { eventsRepo } from "@bandplate/db";
import { z } from "zod";

/**
 * The two `client_ref` namespaces that are the STASH's, not the bridge's.
 *
 * A member's own recordings share the `takes.client_ref` and
 * `events.client_ref` columns with the bridge, kept apart by a prefix each:
 * `stash:` on the take (`STASH_CLIENT_REF_PREFIX`) and `personal:` on the day
 * it sits in (`eventsRepo.PERSONAL_EVENT_CLIENT_REF_PREFIX`). Reading those
 * constants rather than repeating the strings: a reservation that is spelled
 * out twice is one rename away from being no reservation at all.
 */
const RESERVED_CLIENT_REF_PREFIXES = [
  STASH_CLIENT_REF_PREFIX,
  eventsRepo.PERSONAL_EVENT_CLIENT_REF_PREFIX,
];

/**
 * A bridge's own idempotency key — and never one of the stash's.
 *
 * Nothing ENFORCED the split until here, and both halves of it were reachable
 * from outside:
 *
 *   * `clientRef: "stash:local-9"` on a take would have MATCHED a member's
 *     private recording, and `ingest/takes.ts` asserts that a take it finds by
 *     clientRef has a song — which a stash recording need not.
 *   * `personal:<member>:<day>` would have reached a member's stash DAY, as a
 *     take's `eventClientRef` (filing a band take into it) or as the events
 *     route's own `clientRef` (matching and, with `updateMetadata`, editing
 *     it — or creating the row `findOrCreatePersonal` will later hand a member
 *     as their own).
 *
 * So every clientRef the bridge supplies, whether it names a row to write or a
 * row to look up, is refused at the door if it claims either namespace.
 */
const bridgeClientRef = z
  .string()
  .trim()
  .min(1)
  .refine((ref) => !RESERVED_CLIENT_REF_PREFIXES.some((prefix) => ref.startsWith(prefix)), {
    message: `must not start with ${RESERVED_CLIENT_REF_PREFIXES.map((p) => `"${p}"`).join(" or ")} — those prefixes belong to members' own recordings`,
  });

/** ISO-8601 timestamp WITH a numeric offset — contract v1 §4: "the offset is
 * how it knows what you meant." `Z` counts as an offset (zod's `offset: true`
 * accepts it). */
export const isoDatetimeWithOffset = z
  .string()
  .datetime({ offset: true, message: "must be an ISO-8601 timestamp with a UTC offset" })
  .describe("ISO-8601 timestamp with a UTC offset");

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
  /**
   * Which event to file this take into — a LOOKUP, and reserved exactly as
   * hard as a write: a bridge that could name `personal:<member>:<day>` here
   * would drop a band take into somebody's stash day, where it is drawn
   * beside their own private recordings.
   */
  eventClientRef: bridgeClientRef,
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

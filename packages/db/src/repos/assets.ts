import { uuidv7 } from "@bandplate/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { assets, takes } from "../schema/sqlite/index.js";
import { chunk } from "./chunk.js";
import type { TakeVisibility } from "./takes.js";

export type Asset = typeof assets.$inferSelect;
export type AssetKind = Asset["kind"];
export type AssetTier = Asset["tier"];
export type AssetFormat = Asset["format"];
export type AssetStatus = Asset["status"];

export interface CreateAssetInput {
  takeId: string;
  kind: AssetKind;
  /** NULL unless kind === 'stem'. */
  instrumentId?: string | null;
  tier: AssetTier;
  format: AssetFormat;
  storageKey: string;
  contentType: string;
  bytes: number;
  sha256?: string | null;
  durationMs?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  status?: AssetStatus;
  createdAt: number;
  readyAt?: number | null;
}

export async function createMany(db: Db, inputs: CreateAssetInput[]): Promise<Asset[]> {
  if (inputs.length === 0) {
    return [];
  }

  return db
    .insert(assets)
    .values(
      inputs.map((input) => ({
        id: uuidv7(),
        takeId: input.takeId,
        kind: input.kind,
        instrumentId: input.instrumentId ?? null,
        tier: input.tier,
        format: input.format,
        storageKey: input.storageKey,
        contentType: input.contentType,
        bytes: input.bytes,
        sha256: input.sha256 ?? null,
        durationMs: input.durationMs ?? null,
        sampleRate: input.sampleRate ?? null,
        channels: input.channels ?? null,
        status: input.status ?? "pending",
        createdAt: input.createdAt,
        readyAt: input.readyAt ?? null,
      })),
    )
    .returning();
}

export async function listByTake(db: Db, takeId: string): Promise<Asset[]> {
  return db.select().from(assets).where(eq(assets.takeId, takeId));
}

export async function getById(db: Db, id: string): Promise<Asset | undefined> {
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return row;
}

export interface MarkReadyMeta {
  /**
   * Measured, not declared. A browser upload reads this off an `<audio>`
   * element before the PUT; ingest has no measurement and omits it.
   */
  durationMs?: number | null;
  /** The object's real size, when the caller HEADed it. */
  bytes?: number;
}

/**
 * Flip an asset to `ready`, optionally recording what the caller measured in
 * the same statement. The meta is an argument here rather than a second
 * setter precisely so the flip and the measurement cannot end up as two
 * writes — there is no interactive transaction to hold them together.
 */
export async function markReady(
  db: Db,
  id: string,
  readyAt: number,
  meta: MarkReadyMeta = {},
): Promise<void> {
  await db
    .update(assets)
    .set({ status: "ready", readyAt, ...meta })
    .where(eq(assets.id, id));
}

/**
 * Delete one asset row. A single statement, no batch: nothing references an
 * asset, so there are no dependent rows to keep in step.
 *
 * The object in the bucket is a separate, best-effort delete the caller makes
 * afterwards — DB first, so a storage failure leaves an orphaned object
 * rather than a row pointing at nothing. Same ordering and same reasoning as
 * `DELETE /ingest/v1/takes/:takeId`.
 */
export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(assets).where(eq(assets.id, id));
}

/**
 * Looks up the asset occupying one "slot" on a take — identity is
 * `(takeId, kind, coalesce(instrumentId,''), tier)` for a master/stem, and
 * `(takeId, kind)` for peaks. Ingest re-declares take+assets on every retry
 * (contract v1 §3/§4) and needs to find the existing row for a slot, if
 * any, to decide whether to reuse it (matching hash → already `ready`,
 * skip) or reset it to `pending` (hash/format changed → re-upload,
 * overwriting rather than orphaning).
 *
 * `format` is deliberately NOT part of slot identity: it's a property of
 * whatever currently occupies the slot, not part of what names the slot.
 * A re-declaration with a different format is still the same slot (e.g.
 * the lossy master, re-rendered as mp3 instead of opus) — the caller resets
 * the row in place (new storageKey/format included) rather than inserting
 * a second row that would leave the old object orphaned in the bucket
 * (contract v1 §3 "re-running must converge").
 *
 * `tier` is likewise ignored for `kind === 'peaks'`: a bridge mirrors its
 * master's tier onto peaks purely as metadata (contract v1 §5 doesn't
 * assign it meaning), so a peaks re-declaration with a different tier value
 * must still find the one existing peaks row for this take — matching on
 * tier too would miss it and collide with `storage_key`'s UNIQUE
 * constraint instead, since `peaksStorageKey` doesn't vary by tier.
 */
export async function getBySlot(
  db: Db,
  takeId: string,
  kind: AssetKind,
  instrumentId: string | null,
  tier: AssetTier,
): Promise<Asset | undefined> {
  const conditions = [
    eq(assets.takeId, takeId),
    eq(assets.kind, kind),
    instrumentId === null
      ? sql`${assets.instrumentId} IS NULL`
      : eq(assets.instrumentId, instrumentId),
  ];
  if (kind !== "peaks") {
    conditions.push(eq(assets.tier, tier));
  }
  const [row] = await db
    .select()
    .from(assets)
    .where(and(...conditions))
    .limit(1);
  return row;
}

export interface ResetForReuploadInput {
  bytes: number;
  sha256?: string | null;
  contentType: string;
  durationMs?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  /**
   * The freshly-declared storage key/tier/format, when they differ from
   * the row's current ones (a format or a peaks tier change — see
   * `getBySlot`). Omitted when the re-declaration only changed the
   * hash/bytes and the slot's key/tier/format are unchanged.
   */
  storageKey?: string;
  tier?: AssetTier;
  format?: AssetFormat;
}

/**
 * Resets an existing asset slot back to `pending` ahead of a re-upload —
 * the "hash differs" branch of the contract's retry semantics (v1 §4). By
 * default the storage key is unchanged (declared deterministically from
 * `takeId` and the slot), so the eventual re-upload overwrites the same
 * object rather than orphaning a new one. When `storageKey` IS given (a
 * format change, or a peaks tier update), the caller is responsible for
 * deleting the OLD object from the bucket — this only updates the row.
 */
export async function resetForReupload(
  db: Db,
  id: string,
  input: ResetForReuploadInput,
): Promise<void> {
  await db
    .update(assets)
    .set({
      status: "pending",
      bytes: input.bytes,
      sha256: input.sha256 ?? null,
      contentType: input.contentType,
      durationMs: input.durationMs ?? null,
      sampleRate: input.sampleRate ?? null,
      channels: input.channels ?? null,
      readyAt: null,
      ...(input.storageKey !== undefined ? { storageKey: input.storageKey } : {}),
      ...(input.tier !== undefined ? { tier: input.tier } : {}),
      ...(input.format !== undefined ? { format: input.format } : {}),
    })
    .where(eq(assets.id, id));
}

/**
 * Corrects `bytes`/`durationMs` after the real file behind an asset is
 * (re-)uploaded — used by `packages/db/scripts/dev-upload-audio.ts`, whose
 * generated fixture's actual size/duration won't match whatever placeholder
 * numbers a seed row was created with. Never used by the ingest path
 * itself, which should know these values up front.
 */
export async function updateAudioMeta(
  db: Db,
  id: string,
  meta: { bytes: number; durationMs: number },
): Promise<void> {
  await db.update(assets).set(meta).where(eq(assets.id, id));
}

/**
 * Batch-fetches, for each of the given takes, the ONE master asset a play
 * control should link to — the reason `TakeRow`'s leading slot needs this
 * (see `apps/web/src/components/TakeRow.astro`): a take with no ready
 * master asset gets no play control at all, not a disabled one, so every
 * list of takes needs to know which ones qualify before rendering.
 *
 * "Playable" means: `kind = 'master'`, `status = 'ready'`. When both tiers
 * exist, the lossy one wins — it's the one every browser can decode
 * without a plugin, and it's what the persistent player uses as the
 * default source (see task-7-report.md). A take with only a lossless
 * master still gets a play control (better than none), it just isn't the
 * preferred tier.
 */
export async function listPlayableMastersByTakeIds(
  db: Db,
  takeIds: string[],
): Promise<Map<string, Asset>> {
  const result = new Map<string, Asset>();
  if (takeIds.length === 0) {
    return result;
  }

  // Chunked for D1's 100-parameter cap (see `chunk.ts`). A take's assets all
  // come back from one chunk, so the lossy-first choice is unaffected.
  for (const ids of chunk(takeIds, PLAYABLE_CHUNK_SIZE)) {
    const rows = await buildListPlayableMastersChunkQuery(db, ids);
    for (const row of rows) {
      const existing = result.get(row.takeId);
      if (!existing || (existing.tier !== "lossy" && row.tier === "lossy")) {
        result.set(row.takeId, row);
      }
    }
  }
  return result;
}

/** 98: the id list plus `kind = 'master'` and `status = 'ready'`. */
export const PLAYABLE_CHUNK_SIZE = 98;

/** One chunk of `listPlayableMastersByTakeIds`. Exported for testing only. */
export function buildListPlayableMastersChunkQuery(db: Db, takeIds: string[]) {
  return db
    .select()
    .from(assets)
    .where(
      and(inArray(assets.takeId, takeIds), eq(assets.kind, "master"), eq(assets.status, "ready")),
    );
}

/**
 * Whether a take has a ready lossless asset. Always computed, never stored —
 * a stored flag would drift when the underlying asset is purged.
 */
export async function takeHasLossless(db: Db, takeId: string): Promise<boolean> {
  const row = await db.get<{ hasLossless: number }>(sql`
    SELECT EXISTS(
      SELECT 1 FROM ${assets}
      WHERE ${and(eq(assets.takeId, takeId), eq(assets.tier, "lossless"), eq(assets.status, "ready"))}
    ) AS hasLossless
  `);
  return Boolean(row?.hasLossless);
}

/** How many files a set of rows adds up to, and how many bytes. */
export interface AssetTally {
  files: number;
  bytes: number;
}

/**
 * Every asset belonging to every take of a song, tallied in SQL.
 *
 * This is the number in "permanently removes 14 audio files (212 MB)", and it
 * used to be produced by walking the song's takes and issuing `listByTake` per
 * take — a query per take, each returning full rows, on every render of a song
 * page an admin visits. It also stopped being CORRECT the moment those takes
 * became a page: a tally over fifteen of forty takes understates what a delete
 * would destroy, which is the one number on a destructive confirm that must
 * never be too small.
 */
export async function tallyBySong(db: Db, songId: string): Promise<AssetTally> {
  const rows = await db
    .select({
      files: sql<number>`count(${assets.id})`,
      bytes: sql<number>`coalesce(sum(${assets.bytes}), 0)`,
    })
    .from(assets)
    .innerJoin(takes, eq(takes.id, assets.takeId))
    .where(eq(takes.songId, songId));
  return { files: rows[0]?.files ?? 0, bytes: rows[0]?.bytes ?? 0 };
}

/** `tallyBySong`, for one take. */
export async function tallyByTake(db: Db, takeId: string): Promise<AssetTally> {
  const rows = await db
    .select({
      files: sql<number>`count(${assets.id})`,
      bytes: sql<number>`coalesce(sum(${assets.bytes}), 0)`,
    })
    .from(assets)
    .where(eq(assets.takeId, takeId));
  return { files: rows[0]?.files ?? 0, bytes: rows[0]?.bytes ?? 0 };
}

export interface AssetWithTakeAccess {
  asset: Asset;
  visibility: TakeVisibility;
  ownerMemberId: string | null;
}

/**
 * An asset plus the two facts that decide who may fetch it, in ONE query.
 * `GET /assets/:id/audio` is re-hit on every Safari seek, so its authorization
 * has to stay a single indexed read — a second round trip for the take would
 * double the cost of the hottest route in the app.
 */
export async function getByIdWithTakeAccess(
  db: Db,
  id: string,
): Promise<AssetWithTakeAccess | undefined> {
  const [row] = await db
    .select({ asset: assets, visibility: takes.visibility, ownerMemberId: takes.ownerMemberId })
    .from(assets)
    .innerJoin(takes, eq(takes.id, assets.takeId))
    .where(eq(assets.id, id))
    .limit(1);
  return row;
}

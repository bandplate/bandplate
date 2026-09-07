import { uuidv7 } from "@bandlib/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { assets } from "../schema/sqlite/index.js";

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

export async function markReady(db: Db, id: string, readyAt: number): Promise<void> {
  await db.update(assets).set({ status: "ready", readyAt }).where(eq(assets.id, id));
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

  const rows = await db
    .select()
    .from(assets)
    .where(
      and(inArray(assets.takeId, takeIds), eq(assets.kind, "master"), eq(assets.status, "ready")),
    );

  for (const row of rows) {
    const existing = result.get(row.takeId);
    if (!existing || (existing.tier !== "lossy" && row.tier === "lossy")) {
      result.set(row.takeId, row);
    }
  }
  return result;
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

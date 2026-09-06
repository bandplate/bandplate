import { uuidv7 } from "@bandlib/core";
import { and, eq, sql } from "drizzle-orm";
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

export async function markReady(db: Db, id: string, readyAt: number): Promise<void> {
  await db.update(assets).set({ status: "ready", readyAt }).where(eq(assets.id, id));
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

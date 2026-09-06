import { uuidv7 } from "@bandlib/core";
import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { serviceTokens } from "../schema/sqlite/index.js";

export type ServiceToken = typeof serviceTokens.$inferSelect;

export interface CreateServiceTokenInput {
  label: string;
  tokenHash: string;
  scopes: string[];
  createdAt: number;
}

/**
 * Inserts a service token row and returns it (id generated here, same
 * client-generated-id shape as every other repo's `create`). The caller
 * (the auth service) builds the raw `blk_{id}_{secret}` token string using
 * `row.id` from the returned row — the id only needs to exist before the
 * insert commits, not before it's called.
 */
export async function create(db: Db, input: CreateServiceTokenInput): Promise<ServiceToken> {
  const row: ServiceToken = {
    id: uuidv7(),
    label: input.label,
    tokenHash: input.tokenHash,
    scopes: input.scopes,
    createdAt: input.createdAt,
    lastUsedAt: null,
    revokedAt: null,
  };
  await db.insert(serviceTokens).values(row);
  return row;
}

export async function getById(db: Db, id: string): Promise<ServiceToken | undefined> {
  const [row] = await db.select().from(serviceTokens).where(eq(serviceTokens.id, id)).limit(1);
  return row;
}

export async function list(db: Db): Promise<ServiceToken[]> {
  return db.select().from(serviceTokens);
}

export async function setScopes(db: Db, id: string, scopes: string[]): Promise<void> {
  await db.update(serviceTokens).set({ scopes }).where(eq(serviceTokens.id, id));
}

export async function revoke(db: Db, id: string, revokedAt: number): Promise<void> {
  await db.update(serviceTokens).set({ revokedAt }).where(eq(serviceTokens.id, id));
}

export async function touchLastUsed(db: Db, id: string, lastUsedAt: number): Promise<void> {
  await db.update(serviceTokens).set({ lastUsedAt }).where(eq(serviceTokens.id, id));
}

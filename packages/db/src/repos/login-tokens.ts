import { uuidv7 } from "@bandlib/core";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../client.js";
import { loginTokens } from "../schema/sqlite/index.js";

export type LoginToken = typeof loginTokens.$inferSelect;

export interface CreateLoginTokenInput {
  memberId: string;
  tokenHash: string;
  expiresAt: number;
  requestedIp?: string | null;
  createdAt: number;
}

export async function create(db: Db, input: CreateLoginTokenInput): Promise<LoginToken> {
  const row: LoginToken = {
    id: uuidv7(),
    memberId: input.memberId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    usedAt: null,
    requestedIp: input.requestedIp ?? null,
    createdAt: input.createdAt,
  };
  await db.insert(loginTokens).values(row);
  return row;
}

/** Read-only lookup by hash. Never mutates — safe for mail-scanner prefetches. */
export async function getByHash(db: Db, tokenHash: string): Promise<LoginToken | undefined> {
  const [row] = await db
    .select()
    .from(loginTokens)
    .where(eq(loginTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/**
 * Atomic single-use guard: `UPDATE login_tokens SET used_at = ? WHERE
 * token_hash = ? AND used_at IS NULL AND expires_at > ?`, in one statement.
 * Uses `.returning()` rather than inspecting the driver's raw run() result —
 * the shared `Db` interface types that result as `unknown` by design (see
 * `client.ts`), and `token_hash` is unique, so "a row came back" and "rows
 * affected == 1" are exactly the same fact here. Returns the updated row, or
 * `undefined` if the token was missing, already used, or expired — the
 * caller cannot distinguish those three from the return value alone, which
 * is intentional (nothing downstream needs to).
 */
export async function consume(
  db: Db,
  input: { tokenHash: string; now: number },
): Promise<LoginToken | undefined> {
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: input.now })
    .where(
      and(
        eq(loginTokens.tokenHash, input.tokenHash),
        isNull(loginTokens.usedAt),
        gt(loginTokens.expiresAt, input.now),
      ),
    )
    .returning();
  return row;
}

// Short share links: `/s/<code>` -> one song, event or take.
//
// One row per target, for ever (UNIQUE kind + target_id), so the same thing
// shared twice is the same link. The row stores an ID, never a path, and
// `/s/<code>` works out the page at the moment it is opened.
//
// Not a repo that touches `takes`: whether a take may be shared (never a
// private one) and whether a resolved target still exists and is visible are
// the CALLER's checks, made against the target's own repo. This table only
// answers "which code" and "which target".
import { generateShareCode } from "@bandplate/core";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { shareLinks } from "../schema/sqlite/index.js";

export type ShareLink = typeof shareLinks.$inferSelect;
export type ShareKind = ShareLink["kind"];

export const SHARE_KINDS: readonly ShareKind[] = ["song", "event", "take"];

export function isShareKind(value: unknown): value is ShareKind {
  return typeof value === "string" && (SHARE_KINDS as readonly string[]).includes(value);
}

/**
 * How many fresh codes `getOrCreate` tries before giving up. A collision on
 * the code itself is a one-in-billions event at band scale; two in a row
 * would mean the generator is broken, and five is plenty of margin.
 */
export const MAX_CODE_ATTEMPTS = 5;

async function codeFor(db: Db, kind: ShareKind, targetId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ code: shareLinks.code })
    .from(shareLinks)
    .where(and(eq(shareLinks.kind, kind), eq(shareLinks.targetId, targetId)))
    .limit(1);
  return row?.code;
}

/**
 * The target's code, made on first use.
 *
 * Read first, because nearly every call is for something shared before. When
 * there is none: insert with `ON CONFLICT DO NOTHING`, then read back. That
 * one shape covers both conflicts the table can raise. Another request made
 * the target's code first (UNIQUE kind + target_id): the read-back finds
 * theirs, and both callers hand out the same link. Or the random code is
 * already some OTHER target's (the primary key): the read-back finds nothing,
 * and the loop tries a fresh code. No transaction is needed, which matters on
 * D1, which has none.
 */
export async function getOrCreate(
  db: Db,
  kind: ShareKind,
  targetId: string,
  now: number,
  generate: () => string = generateShareCode,
): Promise<string> {
  const existing = await codeFor(db, kind, targetId);
  if (existing) {
    return existing;
  }
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    await db
      .insert(shareLinks)
      .values({ code: generate(), kind, targetId, createdAt: now })
      .onConflictDoNothing();
    const code = await codeFor(db, kind, targetId);
    if (code) {
      return code;
    }
  }
  throw new Error(`no free share code after ${MAX_CODE_ATTEMPTS} attempts`);
}

/** Which target a code names, or undefined for a code nobody issued. */
export async function resolve(
  db: Db,
  code: string,
): Promise<{ kind: ShareKind; targetId: string } | undefined> {
  const [row] = await db
    .select({ kind: shareLinks.kind, targetId: shareLinks.targetId })
    .from(shareLinks)
    .where(eq(shareLinks.code, code))
    .limit(1);
  return row;
}

/**
 * The delete of one target's link, as a statement, for the caller's own
 * `db.batch` (`songsRepo.remove`, `takesRepo.remove` put it beside the rest
 * of what goes with the row).
 */
export function buildRemoveForTargetStatement(db: Db, kind: ShareKind, targetId: string) {
  return db
    .delete(shareLinks)
    .where(and(eq(shareLinks.kind, kind), eq(shareLinks.targetId, targetId)));
}

/** A target's link, gone. Nothing happens when it never had one. */
export async function removeForTarget(db: Db, kind: ShareKind, targetId: string): Promise<void> {
  await buildRemoveForTargetStatement(db, kind, targetId);
}

/**
 * Hands `fromId`'s link to `toId`, for an event merged into another: the takes
 * moved, so a link someone already sent should land where they went.
 *
 * Only when `toId` has no link of its own (one target, one code); otherwise
 * `fromId`'s link is simply dropped. Two statements in one batch: the
 * re-point, guarded by NOT EXISTS so it cannot trip the UNIQUE index, then
 * the delete, which finds nothing left when the re-point happened.
 */
export async function moveToTarget(
  db: Db,
  kind: ShareKind,
  fromId: string,
  toId: string,
): Promise<void> {
  if (fromId === toId) {
    return;
  }
  await db.batch([
    db
      .update(shareLinks)
      .set({ targetId: toId })
      .where(
        and(
          eq(shareLinks.kind, kind),
          eq(shareLinks.targetId, fromId),
          sql`not exists (select 1 from ${shareLinks} where ${shareLinks.kind} = ${kind} and ${shareLinks.targetId} = ${toId})`,
        ),
      ),
    buildRemoveForTargetStatement(db, kind, fromId),
  ]);
}

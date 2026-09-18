import { uuidv7 } from "@bandplate/core";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../client.js";
import { pushSubscriptions } from "../schema/sqlite/index.js";
import { chunk } from "./chunk.js";

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

// D1 headroom for `listForMembers`' `inArray(...)` — see `chunk.ts`.
const MEMBER_CHUNK_SIZE = 90;

export interface UpsertPushSubscriptionInput {
  memberId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  vapidKeyId: string;
  authSessionId?: string | null;
  userAgent?: string | null;
}

/**
 * Insert-or-update by `endpoint` (UNIQUE) — a device re-subscribing lands
 * here every time, on `/me`'s each-load re-upsert. On conflict,
 * `memberId` is reassigned along with the keys: a shared device that
 * switches which member is signed in on it stops notifying the old member
 * the moment it re-subscribes, matching the spec's "upsert on `endpoint`
 * reassigns `member_id`".
 */
export async function upsert(
  db: Db,
  input: UpsertPushSubscriptionInput,
  now: number,
): Promise<void> {
  const authSessionId = input.authSessionId ?? null;
  const userAgent = input.userAgent ?? null;
  await db
    .insert(pushSubscriptions)
    .values({
      id: uuidv7(),
      memberId: input.memberId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      vapidKeyId: input.vapidKeyId,
      authSessionId,
      userAgent,
      createdAt: now,
      updatedAt: now,
      lastSuccessAt: null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        memberId: input.memberId,
        p256dh: input.p256dh,
        auth: input.auth,
        vapidKeyId: input.vapidKeyId,
        authSessionId,
        userAgent,
        updatedAt: now,
      },
    });
}

/**
 * Look up a subscription by its (UNIQUE) endpoint — the API's `POST
 * /push/subscriptions` uses this to tell "this device is already this
 * member's" (an update, exempt from the 10-subscription cap) apart from
 * "a fresh subscription" or "someone else's device re-subscribing under a
 * new member" (both count against the cap).
 */
export async function getByEndpoint(
  db: Db,
  endpoint: string,
): Promise<PushSubscriptionRow | undefined> {
  const [row] = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1);
  return row;
}

/** How many devices one member currently has subscribed — the `/me` "≤10" guard reads this. */
export async function countForMember(db: Db, memberId: string): Promise<number> {
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.memberId, memberId));
  return rows.length;
}

/** Removes one member's subscription for one endpoint — the `/me` "disable on this device" action. */
export async function removeByEndpoint(db: Db, memberId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.memberId, memberId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function removeById(db: Db, id: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
}

/**
 * Builds (without executing) one chunk's query for `listForMembers`.
 * Exported for testing only, so a param-count regression test can assert
 * against `.toSQL()` directly rather than trusting a comment about which
 * values are bound — see `takesRepo.buildCountUnvotedByMembersChunkQuery`'s
 * doc comment for why that trust turned out to be misplaced there.
 */
export function buildListForMembersChunkQuery(db: Db, ids: string[]) {
  return db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.memberId, ids));
}

/**
 * Every subscription belonging to any of the given members — the tick's
 * per-batch fan-out to devices. Chunked (`chunk.ts`) so a large recipient
 * list never exceeds D1's 100-bound-parameter cap on a single statement.
 * Callers must dedupe `memberIds` themselves, matching the rest of this
 * package's batch-fetch helpers.
 */
export async function listForMembers(db: Db, memberIds: string[]): Promise<PushSubscriptionRow[]> {
  if (memberIds.length === 0) {
    return [];
  }
  const results: PushSubscriptionRow[] = [];
  for (const ids of chunk(memberIds, MEMBER_CHUNK_SIZE)) {
    const rows = await buildListForMembersChunkQuery(db, ids);
    results.push(...rows);
  }
  return results;
}

/** Marks a successful send — the sender's happy path, after a real push accepted the payload. */
export async function markSuccess(db: Db, id: string, now: number): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastSuccessAt: now })
    .where(eq(pushSubscriptions.id, id));
}

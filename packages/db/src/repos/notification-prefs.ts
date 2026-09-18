import { eq, inArray } from "drizzle-orm";
import type { Db } from "../client.js";
import { notificationPrefs } from "../schema/sqlite/index.js";
import { chunk } from "./chunk.js";

// D1 allows at most 100 bound parameters per statement — see `chunk.ts`.
const MEMBER_CHUNK_SIZE = 100;

/** The three per-member toggles the spec defines — each defaults to on. */
export interface NotificationPrefs {
  newTakes: boolean;
  weeklyUnvoted: boolean;
  songChanges: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  newTakes: true,
  weeklyUnvoted: true,
  songChanges: true,
};

/**
 * A member's toggles, or the defaults (all on) when they have never opened
 * `/me`'s notification section — no row in `notification_prefs` means
 * nothing was ever turned off.
 */
export async function get(db: Db, memberId: string): Promise<NotificationPrefs> {
  const [row] = await db
    .select({
      newTakes: notificationPrefs.newTakes,
      weeklyUnvoted: notificationPrefs.weeklyUnvoted,
      songChanges: notificationPrefs.songChanges,
    })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.memberId, memberId))
    .limit(1);
  return row ?? DEFAULT_NOTIFICATION_PREFS;
}

/** Upsert — `/me`'s three checkboxes write the whole set every time, never one column at a time. */
export async function set(
  db: Db,
  memberId: string,
  prefs: NotificationPrefs,
  now: number,
): Promise<void> {
  await db
    .insert(notificationPrefs)
    .values({
      memberId,
      newTakes: prefs.newTakes,
      weeklyUnvoted: prefs.weeklyUnvoted,
      songChanges: prefs.songChanges,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationPrefs.memberId,
      set: {
        newTakes: prefs.newTakes,
        weeklyUnvoted: prefs.weeklyUnvoted,
        songChanges: prefs.songChanges,
        updatedAt: now,
      },
    });
}

/**
 * Batch lookup for the tick's recipient selection — only members with an
 * explicit row come back (a member who never touched their prefs isn't
 * "missing", but the caller is expected to fall back to
 * `DEFAULT_NOTIFICATION_PREFS` for any id absent from the returned map, the
 * same "no row = all on" rule `get` applies one member at a time).
 */
export async function listForMembers(
  db: Db,
  memberIds: string[],
): Promise<Map<string, NotificationPrefs>> {
  const result = new Map<string, NotificationPrefs>();
  if (memberIds.length === 0) {
    return result;
  }
  for (const ids of chunk(memberIds, MEMBER_CHUNK_SIZE)) {
    const rows = await db
      .select({
        memberId: notificationPrefs.memberId,
        newTakes: notificationPrefs.newTakes,
        weeklyUnvoted: notificationPrefs.weeklyUnvoted,
        songChanges: notificationPrefs.songChanges,
      })
      .from(notificationPrefs)
      .where(inArray(notificationPrefs.memberId, ids));
    for (const row of rows) {
      result.set(row.memberId, {
        newTakes: row.newTakes,
        weeklyUnvoted: row.weeklyUnvoted,
        songChanges: row.songChanges,
      });
    }
  }
  return result;
}

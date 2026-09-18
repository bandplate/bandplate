import { uuidv7 } from "@bandplate/core";
import { and, eq, gt, isNotNull, isNull, lt, lte, max, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../client.js";
import { notificationClaims, songChartChanges, songs, takes } from "../schema/sqlite/index.js";

// Prune thresholds from the spec's Constants list.
const CHART_CHANGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CLAIM_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// new-takes batches
// ---------------------------------------------------------------------------

export interface PendingTakeBatch {
  eventId: string;
  count: number;
  lastPublishedAt: number;
}

/**
 * Every event with at least one pending take (`published_at IS NOT NULL AND
 * push_batched_at IS NULL`), grouped — what the tick scans each run to
 * decide which events might be ready for a "new takes" push. Reads the
 * partial index `takes_push_pending_idx` (hand-added in migration 0009).
 */
export async function listPendingTakeBatches(db: Db): Promise<PendingTakeBatch[]> {
  const rows = await db
    .select({
      eventId: takes.eventId,
      count: sql<number>`count(*)`,
      lastPublishedAt: max(takes.publishedAt),
    })
    .from(takes)
    .where(and(isNotNull(takes.publishedAt), isNull(takes.pushBatchedAt)))
    .groupBy(takes.eventId);

  return rows
    .filter(
      (row): row is { eventId: string; count: number; lastPublishedAt: number } =>
        row.eventId !== null && row.lastPublishedAt !== null,
    )
    .map((row) => ({
      eventId: row.eventId,
      count: row.count,
      lastPublishedAt: row.lastPublishedAt,
    }));
}

/**
 * Claim-then-send for one event's pending batch: a single `UPDATE ...
 * RETURNING`, so a racing tick (or a second Node instance) can never
 * double-claim the same takes. Claims ONLY when quiet — no pending take of
 * this event was published within the last `quietMs` — expressed as a
 * self-join `NOT EXISTS` (`alias(takes, "t2")`) rather than a read-then-write,
 * so the whole thing is one statement. Returns the claimed take ids (the
 * batch), or `[]` when nothing was pending, the batch wasn't quiet yet, or
 * (a racing claim) it was already taken.
 */
export async function claimTakeBatch(
  db: Db,
  eventId: string,
  now: number,
  quietMs: number,
): Promise<string[]> {
  const t2 = alias(takes, "t2");
  const rows = await db
    .update(takes)
    .set({ pushBatchedAt: now })
    .where(
      and(
        eq(takes.eventId, eventId),
        isNotNull(takes.publishedAt),
        isNull(takes.pushBatchedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(t2)
            .where(
              and(
                eq(t2.eventId, eventId),
                isNotNull(t2.publishedAt),
                isNull(t2.pushBatchedAt),
                gt(t2.publishedAt, now - quietMs),
              ),
            ),
        ),
      ),
    )
    .returning({ id: takes.id });
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// song chart changes
// ---------------------------------------------------------------------------

export interface PendingSongChange {
  songId: string;
  /** `coalesce(chart_notified_at, 0)` at the moment this was read — the CAS pivot for `claimSongNotification`. */
  prev: number;
}

/**
 * Songs with a chord/lyrics change due a push: a change newer than the
 * song's last notification (or ever, if none), throttled to at most once
 * per `throttleMs` (the spec's 6h). `prev` is handed back so the caller's
 * `claimSongNotification(db, songId, prev, now)` CAS is racing against the
 * exact value this read saw, not a value re-derived later (which could have
 * moved between the read and the claim).
 */
export async function listPendingSongChanges(
  db: Db,
  now: number,
  throttleMs: number,
): Promise<PendingSongChange[]> {
  const prevExpr = sql<number>`coalesce(${songs.chartNotifiedAt}, 0)`;
  const rows = await db
    .select({ songId: songs.id, prev: prevExpr })
    .from(songs)
    .innerJoin(songChartChanges, eq(songChartChanges.songId, songs.id))
    .where(
      and(
        sql`${songChartChanges.changedAt} > ${prevExpr}`,
        sql`${prevExpr} <= ${now - throttleMs}`,
      ),
    )
    .groupBy(songs.id);
  return rows.map((row) => ({ songId: row.songId, prev: row.prev }));
}

/**
 * CAS claim: `UPDATE songs SET chart_notified_at = :now WHERE id = :songId
 * AND coalesce(chart_notified_at, 0) = :prev RETURNING id`. Succeeds (once)
 * only if nobody else already claimed this song's push since `prev` was
 * read — a racing tick's claim fails here rather than sending a second
 * notification for the same window.
 */
export async function claimSongNotification(
  db: Db,
  songId: string,
  prev: number,
  now: number,
): Promise<boolean> {
  const rows = await db
    .update(songs)
    .set({ chartNotifiedAt: now })
    .where(and(eq(songs.id, songId), sql`coalesce(${songs.chartNotifiedAt}, 0) = ${prev}`))
    .returning({ id: songs.id });
  return rows.length > 0;
}

export interface SongChangeInWindow {
  memberId: string;
  kind: "created" | "edited";
}

/**
 * Every member who touched a song's chords/lyrics in `(afterExclusive,
 * untilInclusive]` — the recipient-exclusion list for a song push (the spec:
 * "never to whoever made the change"). Exclusive/inclusive on purpose:
 * `afterExclusive` is the previous claim's watermark (already covered by an
 * earlier push, or never), `untilInclusive` is `now`, the instant this
 * claim covers.
 */
export async function listSongChangesInWindow(
  db: Db,
  songId: string,
  afterExclusive: number,
  untilInclusive: number,
): Promise<SongChangeInWindow[]> {
  const rows = await db
    .select({ memberId: songChartChanges.memberId, kind: songChartChanges.kind })
    .from(songChartChanges)
    .where(
      and(
        eq(songChartChanges.songId, songId),
        gt(songChartChanges.changedAt, afterExclusive),
        lte(songChartChanges.changedAt, untilInclusive),
      ),
    );
  return rows;
}

export interface RecordChartChangeInput {
  songId: string;
  memberId: string;
  kind: "created" | "edited";
  changedAt: number;
}

/**
 * Builds (does not execute) one `song_chart_changes` insert, for `Task 7`'s
 * `createSong`/`updateSong` to fold into their own `db.batch([...])` — the
 * write and the change row must land atomically, the same
 * batch-not-transaction shape every other atomic write in this package
 * uses (see `takesRepo.create`'s own doc comment).
 */
export function buildRecordChartChange(db: Db, input: RecordChartChangeInput) {
  return db.insert(songChartChanges).values({
    id: uuidv7(),
    songId: input.songId,
    memberId: input.memberId,
    kind: input.kind,
    changedAt: input.changedAt,
  });
}

// ---------------------------------------------------------------------------
// generic claims (weekly reminder)
// ---------------------------------------------------------------------------

/**
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING` — `true` the first time a
 * given key is claimed, `false` for every claim after (a racing tick, or a
 * retried run). The weekly reminder's key is `weekly:{Prague
 * date}:{memberId}` (one claim per member per Sunday), built by the tick,
 * not this repo.
 */
export async function claimKey(db: Db, key: string, now: number): Promise<boolean> {
  const rows = await db
    .insert(notificationClaims)
    .values({ key, createdAt: now })
    .onConflictDoNothing()
    .returning({ key: notificationClaims.key });
  return rows.length > 0;
}

/**
 * Deletes chart changes older than 30 days and claims older than 60 days —
 * the tick's own housekeeping, run once per tick alongside the actual
 * sends. Two independent deletes (not a `db.batch`): each is already a
 * single statement, and there is no atomicity requirement between them —
 * either one succeeding without the other is still a correct prune, just an
 * incomplete one that the next tick finishes.
 */
export async function prune(db: Db, now: number): Promise<void> {
  await db
    .delete(songChartChanges)
    .where(lt(songChartChanges.changedAt, now - CHART_CHANGE_RETENTION_MS));
  await db
    .delete(notificationClaims)
    .where(lt(notificationClaims.createdAt, now - CLAIM_RETENTION_MS));
}

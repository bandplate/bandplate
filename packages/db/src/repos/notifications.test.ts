import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as members from "./members.js";
import * as notifications from "./notifications.js";
import * as songs from "./songs.js";
import * as takes from "./takes.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("notificationsRepo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  async function createMember(slug: string) {
    return members.create(db, {
      displayName: slug,
      slug,
      email: `${slug}@example.com`,
      createdAt: Date.now(),
    });
  }

  async function createSong(slug: string) {
    return songs.create(db, {
      title: slug,
      slug,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async function createEvent() {
    return events.create(db, {
      kind: "rehearsal",
      heldAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async function createPublishedTake(songId: string, eventId: string, publishedAt: number) {
    return takes
      .create(db, {
        songId,
        eventId,
        recordedAt: publishedAt,
        state: "published",
        createdAt: publishedAt,
        updatedAt: publishedAt,
      })
      .then(async (row) => {
        await takes.setStateWithPublishedAt(db, row.id, "published", publishedAt, publishedAt);
        return row;
      });
  }

  describe("listPendingTakeBatches / claimTakeBatch", () => {
    it("groups pending takes by event, with count and lastPublishedAt", async () => {
      const song = await createSong("takes-song-1");
      const eventA = await createEvent();
      const eventB = await createEvent();
      await createPublishedTake(song.id, eventA.id, 1000);
      await createPublishedTake(song.id, eventA.id, 2000);
      await createPublishedTake(song.id, eventB.id, 3000);

      const batches = await notifications.listPendingTakeBatches(db);
      const byEvent = new Map(batches.map((b) => [b.eventId, b]));

      expect(byEvent.get(eventA.id)).toEqual({
        eventId: eventA.id,
        count: 2,
        lastPublishedAt: 2000,
      });
      expect(byEvent.get(eventB.id)).toEqual({
        eventId: eventB.id,
        count: 1,
        lastPublishedAt: 3000,
      });
    });

    it("claim returns the pending take ids once and [] the second time", async () => {
      const song = await createSong("takes-song-2");
      const event = await createEvent();
      const t1 = await createPublishedTake(song.id, event.id, 1000);
      const t2 = await createPublishedTake(song.id, event.id, 2000);

      const now = 3000;
      const quietMs = 500;
      const claimed = await notifications.claimTakeBatch(db, event.id, now, quietMs);
      expect(new Set(claimed)).toEqual(new Set([t1.id, t2.id]));

      const secondClaim = await notifications.claimTakeBatch(db, event.id, now + 1000, quietMs);
      expect(secondClaim).toEqual([]);
    });

    it("claim returns [] while a take published less than quietMs ago is pending", async () => {
      const song = await createSong("takes-song-3");
      const event = await createEvent();
      const now = 10_000;
      const quietMs = 600_000;
      await createPublishedTake(song.id, event.id, now - 100);

      const claimed = await notifications.claimTakeBatch(db, event.id, now, quietMs);
      expect(claimed).toEqual([]);

      // Confirmed still pending — nothing was marked as claimed.
      const batches = await notifications.listPendingTakeBatches(db);
      expect(batches.find((b) => b.eventId === event.id)?.count).toBe(1);
    });

    it("claim ignores takes from other events", async () => {
      const song = await createSong("takes-song-4");
      const eventA = await createEvent();
      const eventB = await createEvent();
      const tA = await createPublishedTake(song.id, eventA.id, 1000);
      await createPublishedTake(song.id, eventB.id, 1000);

      const claimed = await notifications.claimTakeBatch(db, eventA.id, 5000, 500);
      expect(claimed).toEqual([tA.id]);
    });

    // Fix round 1, finding 2: an old pending take does NOT get claimed on
    // its own just because it's old — the self-join `NOT EXISTS` gates the
    // whole event's batch (old take included) on whether ANY pending take
    // of that event is still within the quiet period, not per-take.
    it("claim returns [] when one pending take is old and another is recent (quiet period is per-event, not per-take)", async () => {
      const song = await createSong("takes-song-5");
      const event = await createEvent();
      const now = 100_000;
      const quietMs = 600_000;
      await createPublishedTake(song.id, event.id, now - quietMs - 1);
      await createPublishedTake(song.id, event.id, now - 100);

      const claimed = await notifications.claimTakeBatch(db, event.id, now, quietMs);
      expect(claimed).toEqual([]);

      // Neither take was claimed — both, including the old one, are still pending.
      const batches = await notifications.listPendingTakeBatches(db);
      const batch = batches.find((b) => b.eventId === event.id);
      expect(batch?.count).toBe(2);
      expect(batch?.lastPublishedAt).toBe(now - 100);
    });
  });

  describe("song chart changes", () => {
    it("buildRecordChartChange + listPendingSongChanges/claimSongNotification/listSongChangesInWindow", async () => {
      const song = await createSong("chart-song-1");
      const author = await createMember("chart-author-1");
      const other = await createMember("chart-other-1");

      // Small, round numbers rather than the real 6h constant — the CAS
      // pivot is `coalesce(chart_notified_at, 0)` vs `now - throttleMs`, an
      // epoch-relative comparison, not a "time since the change" one, so
      // the throttle math is easiest to follow measured from t=0.
      const throttleMs = 100;
      const changedAt = 10;
      await db.batch([
        notifications.buildRecordChartChange(db, {
          songId: song.id,
          memberId: author.id,
          kind: "edited",
          changedAt,
        }),
      ]);

      // Before a single throttle window has elapsed since epoch, prev(0) is
      // not yet "<= now - throttleMs" — too soon for even a first-ever push.
      const tooSoon = await notifications.listPendingSongChanges(db, throttleMs - 1, throttleMs);
      expect(tooSoon).toEqual([]);

      const now = throttleMs; // prev(0) <= now - throttleMs (0) — exactly at the boundary.
      const pending = await notifications.listPendingSongChanges(db, now, throttleMs);
      expect(pending).toEqual([{ songId: song.id, prev: 0 }]);

      const claimedFirst = await notifications.claimSongNotification(db, song.id, 0, now);
      expect(claimedFirst).toBe(true);

      // Same prev again must fail — already claimed (chart_notified_at is now `now`, not 0).
      const claimedAgain = await notifications.claimSongNotification(db, song.id, 0, now + 1);
      expect(claimedAgain).toBe(false);

      const inWindow = await notifications.listSongChangesInWindow(db, song.id, 0, now);
      expect(inWindow).toEqual([{ memberId: author.id, kind: "edited", changedAt }]);

      // A second change from a different member, right after the claim.
      const changedAt2 = now + 5;
      await db.batch([
        notifications.buildRecordChartChange(db, {
          songId: song.id,
          memberId: other.id,
          kind: "edited",
          changedAt: changedAt2,
        }),
      ]);

      // Throttled: prev(now) > (now + throttleMs - 1) - throttleMs.
      const stillThrottled = await notifications.listPendingSongChanges(
        db,
        now + throttleMs - 1,
        throttleMs,
      );
      expect(stillThrottled).toEqual([]);

      // A full throttle window after the claim, the new change is pending again.
      const nextNow = now + throttleMs;
      const pendingAgain = await notifications.listPendingSongChanges(db, nextNow, throttleMs);
      expect(pendingAgain).toEqual([{ songId: song.id, prev: now }]);

      const claimedNext = await notifications.claimSongNotification(db, song.id, now, nextNow);
      expect(claimedNext).toBe(true);

      // Only the change AFTER the previous claim's watermark is in this window.
      const nextWindow = await notifications.listSongChangesInWindow(db, song.id, now, nextNow);
      expect(nextWindow).toEqual([{ memberId: other.id, kind: "edited", changedAt: changedAt2 }]);
    });

    it("claimSongNotification is a no-op (false) when prev no longer matches", async () => {
      const song = await createSong("chart-song-2");
      const claimed = await notifications.claimSongNotification(db, song.id, 999, 5000);
      expect(claimed).toBe(false);
    });
  });

  describe("claimKey", () => {
    it("returns true the first time and false for a repeat of the same key", async () => {
      const first = await notifications.claimKey(db, "weekly:2026-09-20:member-1", 1000);
      expect(first).toBe(true);

      const second = await notifications.claimKey(db, "weekly:2026-09-20:member-1", 2000);
      expect(second).toBe(false);
    });

    it("different keys claim independently", async () => {
      expect(await notifications.claimKey(db, "weekly:2026-09-20:member-1", 1000)).toBe(true);
      expect(await notifications.claimKey(db, "weekly:2026-09-20:member-2", 1000)).toBe(true);
    });
  });

  describe("prune", () => {
    it("removes chart changes older than 30 days and claims older than 60 days, keeps the rest", async () => {
      const song = await createSong("prune-song");
      const member = await createMember("prune-member");
      const now = 100 * DAY_MS;

      await db.batch([
        notifications.buildRecordChartChange(db, {
          songId: song.id,
          memberId: member.id,
          kind: "created",
          changedAt: now - 31 * DAY_MS,
        }),
      ]);
      await db.batch([
        notifications.buildRecordChartChange(db, {
          songId: song.id,
          memberId: member.id,
          kind: "edited",
          changedAt: now - 10 * DAY_MS,
        }),
      ]);
      await notifications.claimKey(db, "old-claim", now - 61 * DAY_MS);
      await notifications.claimKey(db, "recent-claim", now - 5 * DAY_MS);

      await notifications.prune(db, now);

      const remainingChanges = await notifications.listSongChangesInWindow(db, song.id, 0, now);
      expect(remainingChanges).toEqual([
        { memberId: member.id, kind: "edited", changedAt: now - 10 * DAY_MS },
      ]);

      // Pruned claim keys can be claimed again; a still-live one cannot.
      expect(await notifications.claimKey(db, "old-claim", now)).toBe(true);
      expect(await notifications.claimKey(db, "recent-claim", now)).toBe(false);
    });
  });
});

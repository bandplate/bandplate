// `runNotificationTick` end-to-end against a real (in-memory) db — the
// scenarios the brief specs, not a re-test of the pure logic modules'
// own unit tests (schedule.test.ts, new-takes.test.ts, songs.test.ts, ...).
//
// The recording push sender is written here rather than imported from
// `@bandplate/push`: that package depends on `@bandplate/core` (for the
// `PushSender`/`PushResult` types it implements), so a devDependency the
// other way round would be a cycle. A dozen lines is cheaper than that.
import {
  type Db,
  eventsRepo,
  membersRepo,
  notificationPrefsRepo,
  notificationsRepo,
  pushSubscriptionsRepo,
  schema,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import type { Locale } from "@bandplate/i18n";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../ports/clock.js";
import type { PushResult, PushSender, PushTarget } from "../ports/push.js";
import { runNotificationTick } from "./tick.js";

const VAPID_KEY_ID = "abcd1234abcd1234";

function fakeClock(startAt: number): Clock & { advance(ms: number): void } {
  let now = startAt;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

interface RecordedPush {
  target: PushTarget;
  payload: string;
  options: { ttlSeconds: number; topic?: string };
}

function recordingPushSender(
  results?: (target: PushTarget) => PushResult,
): PushSender & { sent: RecordedPush[] } {
  const sent: RecordedPush[] = [];
  return {
    sent,
    async send(target, payload, options): Promise<PushResult> {
      sent.push({ target, payload, options });
      return results ? results(target) : { kind: "ok" };
    },
  };
}

// A Sunday 19:05 Europe/Prague, well clear of any DST boundary (2026-03-29
// and 2026-10-25 are `schedule.test.ts`'s own concern, not this file's).
// 2026-08-16 is a Sunday; Prague is UTC+2 (CEST) then, so 19:05 local is
// 17:05 UTC.
const SUNDAY_1905_PRAGUE_UTC = Date.parse("2026-08-16T17:05:00Z");

describe("runNotificationTick", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  async function seedMember(
    displayName: string,
    slug: string,
    locale: Locale = "en",
  ): Promise<string> {
    const member = await membersRepo.create(db, {
      displayName,
      slug,
      email: `${slug}@example.com`,
      status: "active",
      createdAt: 1000,
      locale,
    });
    return member.id;
  }

  async function subscribe(memberId: string, endpointSuffix: string, vapidKeyId = VAPID_KEY_ID) {
    await pushSubscriptionsRepo.upsert(
      db,
      {
        memberId,
        endpoint: `https://fcm.googleapis.com/fcm/send/${endpointSuffix}`,
        p256dh: "p256dh",
        auth: "auth",
        vapidKeyId,
      },
      1000,
    );
  }

  describe("new takes", () => {
    async function seedEvent(): Promise<{ eventId: string; songId: string }> {
      const song = await songsRepo.create(db, {
        title: "Song A",
        slug: "song-a",
        createdAt: 1000,
        updatedAt: 1000,
      });
      const event = await eventsRepo.create(db, {
        kind: "rehearsal",
        heldAt: 1000,
        createdAt: 1000,
        updatedAt: 1000,
      });
      return { eventId: event.id, songId: song.id };
    }

    async function publishTake(songId: string, eventId: string, at: number) {
      const take = await takesRepo.create(db, {
        songId,
        eventId,
        recordedAt: at,
        createdAt: at,
        updatedAt: at,
      });
      await takesRepo.setStateWithPublishedAt(db, take.id, "published", at, at);
      return take.id;
    }

    it("waits for the quiet period, then sends one message with the total count", async () => {
      const memberId = await seedMember("Alice", "alice");
      await subscribe(memberId, "alice-device");
      const { eventId, songId } = await seedEvent();

      const clock = fakeClock(1_000_000);
      const push = recordingPushSender();

      await publishTake(songId, eventId, clock.now());
      clock.advance(120_000);
      await publishTake(songId, eventId, clock.now());
      clock.advance(120_000);
      await publishTake(songId, eventId, clock.now());

      // Not yet quiet: nothing sends.
      let result = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result.sent).toBe(0);
      expect(push.sent).toHaveLength(0);

      // 10 minutes after the LAST take: now quiet.
      clock.advance(600_000);
      result = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result.sent).toBe(1);
      expect(push.sent).toHaveLength(1);
      const payload = JSON.parse(push.sent[0]?.payload ?? "{}");
      expect(payload.body).toContain("3");

      // A later take starts a fresh batch.
      clock.advance(1000);
      await publishTake(songId, eventId, clock.now());
      clock.advance(600_000);
      result = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result.sent).toBe(1);
      expect(push.sent).toHaveLength(2);
    });

    it("never sends for the backfilled archive (push_batched_at already set)", async () => {
      const memberId = await seedMember("Alice", "alice");
      await subscribe(memberId, "alice-device");
      const { eventId, songId } = await seedEvent();

      const clock = fakeClock(1_000_000);
      await publishTake(songId, eventId, clock.now());
      // Simulate the migration backfill: claim the batch immediately (no
      // quiet-period wait needed here) so `push_batched_at` is set exactly
      // as the real backfill UPDATE sets it, without ever sending for it.
      await notificationsRepo.claimTakeBatch(db, eventId, clock.now(), 0);

      clock.advance(700_000);
      const push = recordingPushSender();
      const result = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result.sent).toBe(0);
      expect(push.sent).toHaveLength(0);
    });

    it("claims a stale batch silently, without sending", async () => {
      const memberId = await seedMember("Alice", "alice");
      await subscribe(memberId, "alice-device");
      const { eventId, songId } = await seedEvent();

      const clock = fakeClock(1_000_000);
      await publishTake(songId, eventId, clock.now());

      // 24h+ later, still "quiet" (no newer take), but stale.
      clock.advance(86_400_000 + 1);
      const push = recordingPushSender();
      const result = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result.skippedStale).toBe(1);
      expect(result.sent).toBe(0);
      expect(push.sent).toHaveLength(0);

      // The batch is claimed — a second tick sees nothing pending.
      clock.advance(1);
      const result2 = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result2.skippedStale).toBe(0);
      expect(push.sent).toHaveLength(0);
    });

    it("uses each member's own locale", async () => {
      const enId = await seedMember("Alice", "alice", "en");
      const csId = await seedMember("Bob", "bob", "cs");
      await subscribe(enId, "alice-device");
      await subscribe(csId, "bob-device");
      const { eventId, songId } = await seedEvent();

      const clock = fakeClock(1_000_000);
      await publishTake(songId, eventId, clock.now());
      clock.advance(600_000);

      const push = recordingPushSender();
      await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(push.sent).toHaveLength(2);
      // Bodies differ across locales for the same event/count.
      const bodies = new Set(push.sent.map((p) => JSON.parse(p.payload).body));
      expect(bodies.size).toBe(2);
    });
  });

  describe("songs", () => {
    it("throttles edits by the same editor into one message, excludes only that window's editors", async () => {
      const memberA = await seedMember("Editor A", "editor-a");
      const memberB = await seedMember("Member B", "member-b");
      const memberC = await seedMember("Member C", "member-c");
      await subscribe(memberA, "a-device");
      await subscribe(memberB, "b-device");
      await subscribe(memberC, "c-device");

      // Starts well past the throttle window so `prev` (0, "never notified")
      // already satisfies `prev <= now - throttleMs` for the first claim.
      const clock = fakeClock(100_000_000);
      const song = await songsRepo.create(db, {
        title: "Song B",
        slug: "song-b",
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });

      // Two edits by A within the 6h throttle window.
      await db.insert(schema.songChartChanges).values({
        id: "chg-1",
        songId: song.id,
        memberId: memberA,
        kind: "edited",
        changedAt: clock.now(),
      });
      clock.advance(60 * 60 * 1000);
      await db.insert(schema.songChartChanges).values({
        id: "chg-2",
        songId: song.id,
        memberId: memberA,
        kind: "edited",
        changedAt: clock.now(),
      });

      const push = recordingPushSender();
      const result = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result.sent).toBe(2); // B and C, not A.
      const targets = new Set(push.sent.map((p) => p.target.endpoint));
      expect(targets.has("https://fcm.googleapis.com/fcm/send/a-device")).toBe(false);
      expect(targets.has("https://fcm.googleapis.com/fcm/send/b-device")).toBe(true);
      expect(targets.has("https://fcm.googleapis.com/fcm/send/c-device")).toBe(true);

      // A third edit, 1h after the last notification: not yet due.
      clock.advance(60 * 60 * 1000);
      await db.insert(schema.songChartChanges).values({
        id: "chg-3",
        songId: song.id,
        memberId: memberB,
        kind: "edited",
        changedAt: clock.now(),
      });
      const resultTooSoon = await runNotificationTick({
        db,
        clock,
        push,
        vapidKeyId: VAPID_KEY_ID,
      });
      expect(resultTooSoon.sent).toBe(0);

      // 6h after THAT edit: the second window's own editor (B) is excluded,
      // A and C receive it.
      clock.advance(6 * 60 * 60 * 1000);
      push.sent.length = 0;
      const resultDue = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(resultDue.sent).toBe(2); // A and C, not B.
      const targets2 = new Set(push.sent.map((p) => p.target.endpoint));
      expect(targets2.has("https://fcm.googleapis.com/fcm/send/b-device")).toBe(false);
      expect(targets2.has("https://fcm.googleapis.com/fcm/send/a-device")).toBe(true);
      expect(targets2.has("https://fcm.googleapis.com/fcm/send/c-device")).toBe(true);
    });
  });

  describe("weekly", () => {
    async function seedPublishedTake(): Promise<string> {
      const song = await songsRepo.create(db, {
        title: `Weekly Song ${Math.random()}`,
        slug: `weekly-song-${Math.random().toString(36).slice(2)}`,
        createdAt: 1000,
        updatedAt: 1000,
      });
      const event = await eventsRepo.create(db, {
        kind: "rehearsal",
        heldAt: 1000,
        createdAt: 1000,
        updatedAt: 1000,
      });
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: 1000,
        createdAt: 1000,
        updatedAt: 1000,
      });
      await takesRepo.setStateWithPublishedAt(db, take.id, "published", 1000, 1000);
      return take.id;
    }

    it("sends once per member with unvoted takes, nothing on a same-evening retick, nothing with 0 unvoted, nothing when opted out", async () => {
      const withUnvoted = await seedMember("Has Unvoted", "has-unvoted");
      const noUnvoted = await seedMember("No Unvoted", "no-unvoted");
      const optedOut = await seedMember("Opted Out", "opted-out");
      await subscribe(withUnvoted, "d1");
      await subscribe(noUnvoted, "d2");
      await subscribe(optedOut, "d3");

      const takeId = await seedPublishedTake();
      // `noUnvoted` and `optedOut` both vote it away, so it's unvoted only
      // for `withUnvoted` (a published take otherwise counts as unvoted for
      // EVERY active member who hasn't voted on it yet).
      await votesRepo.castVote(db, { takeId, memberId: noUnvoted, keeper: true, now: 1000 });
      await votesRepo.castVote(db, { takeId, memberId: optedOut, keeper: true, now: 1000 });

      await notificationPrefsRepo.set(
        db,
        optedOut,
        { newTakes: true, weeklyUnvoted: false, songChanges: true },
        1000,
      );

      const clock = fakeClock(SUNDAY_1905_PRAGUE_UTC);
      const push = recordingPushSender();
      const result = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result.sent).toBe(1);
      expect(push.sent).toHaveLength(1);
      expect(push.sent[0]?.target.endpoint).toBe("https://fcm.googleapis.com/fcm/send/d1");

      // Same evening, a second tick: already claimed, sends nothing more.
      clock.advance(10 * 60 * 1000);
      const result2 = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result2.sent).toBe(0);
      expect(push.sent).toHaveLength(1);
    });
  });

  describe("subscription housekeeping", () => {
    async function seedReadyBatch(memberId: string): Promise<void> {
      const song = await songsRepo.create(db, {
        title: "Housekeeping Song",
        slug: "housekeeping-song",
        createdAt: 1000,
        updatedAt: 1000,
      });
      const event = await eventsRepo.create(db, {
        kind: "rehearsal",
        heldAt: 1000,
        createdAt: 1000,
        updatedAt: 1000,
      });
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: 1000,
        createdAt: 1000,
        updatedAt: 1000,
      });
      await takesRepo.setStateWithPublishedAt(db, take.id, "published", 1000, 1000);
      void memberId;
    }

    it("removes a subscription that comes back 'gone', without retrying it", async () => {
      const memberId = await seedMember("Gone Guy", "gone-guy");
      await subscribe(memberId, "gone-device");
      await seedReadyBatch(memberId);

      const clock = fakeClock(1_000_000);
      clock.advance(600_000);
      const push = recordingPushSender(() => ({ kind: "gone" }));
      const result = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result.gone).toBe(1);
      expect(await pushSubscriptionsRepo.countForMember(db, memberId)).toBe(0);
    });

    it("removes a subscription with a mismatched vapidKeyId without sending to it", async () => {
      const memberId = await seedMember("Old Keys", "old-keys");
      await subscribe(memberId, "old-device", "stalekeyid1234567");
      await seedReadyBatch(memberId);

      const clock = fakeClock(1_000_000);
      clock.advance(600_000);
      const push = recordingPushSender();
      const result = await runNotificationTick({ db, clock, push, vapidKeyId: VAPID_KEY_ID });
      expect(result.sent).toBe(0);
      expect(push.sent).toHaveLength(0);
      expect(await pushSubscriptionsRepo.countForMember(db, memberId)).toBe(0);
    });
  });
});

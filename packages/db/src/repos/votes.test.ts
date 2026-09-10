import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as members from "./members.js";
import * as songs from "./songs.js";
import * as takes from "./takes.js";
import * as votes from "./votes.js";

async function seedTake(db: Db) {
  const now = Date.now();
  const song = await songs.create(db, {
    title: "Test Song",
    slug: "test-song",
    createdAt: now,
    updatedAt: now,
  });
  const event = await events.create(db, {
    kind: "rehearsal",
    heldAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const take = await takes.create(db, {
    songId: song.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return take;
}

async function seedMember(db: Db, email: string) {
  return members.create(db, {
    displayName: email,
    slug: email,
    email,
    createdAt: Date.now(),
  });
}

describe("votes.castVote", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("inserts a vote and recomputes aggregates", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "a@example.com");

    await votes.castVote(db, {
      takeId: take.id,
      memberId: member.id,
      keeper: true,
      now: Date.now(),
    });

    const row = await takes.getById(db, take.id);
    expect(row?.keeperVotes).toBe(1);
    expect(row?.totalVotes).toBe(1);
    expect(row?.ratingScore).toBe(1);
  });

  it("the zero-vote case yields ratingScore 0, not null", async () => {
    // castVote's upsert always precedes the aggregate UPDATE in the same
    // batch, so the zero-vote branch is unreachable through castVote itself
    // (there is always at least one vote row by the time the UPDATE runs).
    // Exercise the aggregate statement directly, against a take with an
    // empty votes table, to prove the COALESCE in
    // votes.buildAggregateUpdate is load-bearing: SUM/COUNT over zero rows
    // is NULL, and ratingScore is NOT NULL.
    const take = await seedTake(db);

    await db.batch([votes.buildAggregateUpdate(db, take.id, Date.now())]);

    const row = await takes.getById(db, take.id);
    expect(row?.ratingScore).toBe(0);
    expect(row?.ratingScore).not.toBeNull();
    expect(row?.totalVotes).toBe(0);
    expect(row?.keeperVotes).toBe(0);
  });

  it("a second vote by the same member updates rather than duplicating", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "b@example.com");

    await votes.castVote(db, { takeId: take.id, memberId: member.id, keeper: true, now: 1000 });
    await votes.castVote(db, { takeId: take.id, memberId: member.id, keeper: true, now: 2000 });

    const { rows: memberVotes } = await votes.listByMember(db, member.id);
    expect(memberVotes.length).toBe(1);

    const row = await takes.getById(db, take.id);
    expect(row?.totalVotes).toBe(1);
  });

  it("changing a vote from keeper to not-keeper recomputes aggregates correctly", async () => {
    const take = await seedTake(db);
    const memberA = await seedMember(db, "c@example.com");
    const memberB = await seedMember(db, "d@example.com");

    await votes.castVote(db, { takeId: take.id, memberId: memberA.id, keeper: true, now: 1000 });
    await votes.castVote(db, { takeId: take.id, memberId: memberB.id, keeper: true, now: 1000 });

    let row = await takes.getById(db, take.id);
    expect(row?.keeperVotes).toBe(2);
    expect(row?.totalVotes).toBe(2);
    expect(row?.ratingScore).toBe(1);

    // memberA changes their mind
    await votes.castVote(db, { takeId: take.id, memberId: memberA.id, keeper: false, now: 2000 });

    row = await takes.getById(db, take.id);
    expect(row?.keeperVotes).toBe(1);
    expect(row?.totalVotes).toBe(2);
    expect(row?.ratingScore).toBe(0.5);
  });

  it("stores the comment and updates it on re-vote", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "e@example.com");

    await votes.castVote(db, {
      takeId: take.id,
      memberId: member.id,
      keeper: true,
      comment: "great take",
      now: 1000,
    });
    await votes.castVote(db, {
      takeId: take.id,
      memberId: member.id,
      keeper: true,
      comment: "actually, love it",
      now: 2000,
    });

    const [vote] = await votes.listByTake(db, take.id);
    expect(vote?.comment).toBe("actually, love it");
  });

  it("removeVote deletes the vote and recomputes aggregates back to zero", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "g@example.com");

    await votes.castVote(db, { takeId: take.id, memberId: member.id, keeper: true, now: 1000 });
    let row = await takes.getById(db, take.id);
    expect(row?.totalVotes).toBe(1);

    await votes.removeVote(db, { takeId: take.id, memberId: member.id, now: 2000 });

    row = await takes.getById(db, take.id);
    expect(row?.keeperVotes).toBe(0);
    expect(row?.totalVotes).toBe(0);
    expect(row?.ratingScore).toBe(0);
    expect(row?.ratingScore).not.toBeNull();

    const { rows: memberVotes } = await votes.listByMember(db, member.id);
    expect(memberVotes.length).toBe(0);
  });

  it("removeVote only removes the acting member's own vote — another member's vote and the aggregate it contributes stay intact", async () => {
    const take = await seedTake(db);
    const memberA = await seedMember(db, "h@example.com");
    const memberB = await seedMember(db, "i@example.com");

    await votes.castVote(db, { takeId: take.id, memberId: memberA.id, keeper: true, now: 1000 });
    await votes.castVote(db, { takeId: take.id, memberId: memberB.id, keeper: false, now: 1000 });

    await votes.removeVote(db, { takeId: take.id, memberId: memberA.id, now: 2000 });

    const row = await takes.getById(db, take.id);
    expect(row?.totalVotes).toBe(1);
    expect(row?.keeperVotes).toBe(0);

    const remaining = await votes.listByTake(db, take.id);
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.memberId).toBe(memberB.id);
  });

  it("listByMemberForTakes returns a Map of only this member's votes on the given takes", async () => {
    // `seedTake` always creates a song/event with the same slug/clientRef,
    // so three takes for this one test share a single song/event instead
    // of calling it three times (which would collide on `songs.slug`).
    const now = Date.now();
    const song = await songs.create(db, {
      title: "Shared Song",
      slug: "shared-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const makeTake = () =>
      takes.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    const takeA = await makeTake();
    const takeB = await makeTake();
    const takeC = await makeTake();
    const memberA = await seedMember(db, "j@example.com");
    const memberB = await seedMember(db, "k@example.com");

    await votes.castVote(db, { takeId: takeA.id, memberId: memberA.id, keeper: true, now: 1000 });
    await votes.castVote(db, { takeId: takeB.id, memberId: memberA.id, keeper: false, now: 1000 });
    // memberB's own vote on takeC must not leak into memberA's map.
    await votes.castVote(db, { takeId: takeC.id, memberId: memberB.id, keeper: true, now: 1000 });

    const map = await votes.listByMemberForTakes(db, memberA.id, [takeA.id, takeB.id, takeC.id]);
    expect(map.get(takeA.id)).toBe(true);
    expect(map.get(takeB.id)).toBe(false);
    expect(map.has(takeC.id)).toBe(false);
  });

  it("listByMemberForTakes returns an empty Map for an empty takeIds array", async () => {
    const member = await seedMember(db, "l@example.com");
    const map = await votes.listByMemberForTakes(db, member.id, []);
    expect(map.size).toBe(0);
  });

  it("a disabled member's vote still resolves (nothing requires deleting members)", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "f@example.com");
    await votes.castVote(db, { takeId: take.id, memberId: member.id, keeper: true, now: 1000 });

    await members.setStatus(db, member.id, "disabled");

    const resolved = await members.getById(db, member.id);
    expect(resolved?.status).toBe("disabled");

    const { rows: memberVotes } = await votes.listByMember(db, member.id);
    expect(memberVotes.length).toBe(1);
    expect(memberVotes[0]?.memberId).toBe(member.id);
  });
});

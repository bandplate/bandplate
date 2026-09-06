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
    const take = await seedTake(db);
    expect(take.ratingScore).toBe(0);
    expect(take.totalVotes).toBe(0);
    expect(take.keeperVotes).toBe(0);
  });

  it("a second vote by the same member updates rather than duplicating", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "b@example.com");

    await votes.castVote(db, { takeId: take.id, memberId: member.id, keeper: true, now: 1000 });
    await votes.castVote(db, { takeId: take.id, memberId: member.id, keeper: true, now: 2000 });

    const memberVotes = await votes.listByMember(db, member.id);
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

  it("a disabled member's vote still resolves (nothing requires deleting members)", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "f@example.com");
    await votes.castVote(db, { takeId: take.id, memberId: member.id, keeper: true, now: 1000 });

    await members.setStatus(db, member.id, "disabled");

    const resolved = await members.getById(db, member.id);
    expect(resolved?.status).toBe("disabled");

    const memberVotes = await votes.listByMember(db, member.id);
    expect(memberVotes.length).toBe(1);
    expect(memberVotes[0]?.memberId).toBe(member.id);
  });
});

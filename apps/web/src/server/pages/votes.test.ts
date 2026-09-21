import type { Db } from "@bandplate/db";
import { eventsRepo, membersRepo, songsRepo, takesRepo, votesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { castVoteFromForm } from "./votes.js";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

async function seedTake(db: Db) {
  const now = Date.now();
  const song = await songsRepo.create(db, {
    title: "Vote Form Song",
    slug: "vote-form-song",
    createdAt: now,
    updatedAt: now,
  });
  const event = await eventsRepo.create(db, {
    kind: "rehearsal",
    heldAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return takesRepo.create(db, {
    songId: song.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedMember(db: Db, email: string) {
  return membersRepo.create(db, {
    displayName: email,
    slug: email,
    email,
    createdAt: Date.now(),
  });
}

describe("castVoteFromForm", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("casts a keeper vote and returns the fresh tally", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "voter@example.com");

    const result = await castVoteFromForm(
      db,
      member.id,
      take.id,
      formData({ keeper: "true" }),
      1000,
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.keeper).toBe(true);
      expect(result.tally).toEqual({
        takeId: take.id,
        keeperVotes: 1,
        totalVotes: 1,
        ratingScore: 1,
      });
    }
  });

  it("casts a not-keeper vote (keeper=false)", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "voter2@example.com");

    const result = await castVoteFromForm(
      db,
      member.id,
      take.id,
      formData({ keeper: "false" }),
      1000,
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.keeper).toBe(false);
      expect(result.tally.keeperVotes).toBe(0);
      expect(result.tally.totalVotes).toBe(1);
    }
  });

  it("uses memberId as GIVEN, never anything from the form — the form has no memberId field at all", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "voter3@example.com");
    const otherMember = await seedMember(db, "other@example.com");

    // Even if a caller stuffed a stray `memberId` field into the FormData
    // (not part of the schema this function reads), it must be ignored —
    // proven by checking who the vote actually landed as.
    const fd = formData({ keeper: "true" });
    fd.set("memberId", otherMember.id);

    await castVoteFromForm(db, member.id, take.id, fd, 1000);

    const takeVotes = await votesRepo.listByTake(db, take.id);
    expect(takeVotes.length).toBe(1);
    expect(takeVotes[0]?.memberId).toBe(member.id);
    expect(takeVotes[0]?.memberId).not.toBe(otherMember.id);
  });

  it("is invalid when keeper is missing or not 'true'/'false'", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "voter4@example.com");

    const missing = await castVoteFromForm(db, member.id, take.id, formData({}), 1000);
    expect(missing.kind).toBe("invalid");

    const garbage = await castVoteFromForm(
      db,
      member.id,
      take.id,
      formData({ keeper: "yes" }),
      1000,
    );
    expect(garbage.kind).toBe("invalid");
  });

  it("is not_found for a take id that doesn't exist", async () => {
    const member = await seedMember(db, "voter5@example.com");

    const result = await castVoteFromForm(
      db,
      member.id,
      "not-a-real-take",
      formData({ keeper: "true" }),
      1000,
    );
    expect(result.kind).toBe("not_found");
  });

  it("changing a vote updates the tally rather than duplicating the row", async () => {
    const take = await seedTake(db);
    const member = await seedMember(db, "voter6@example.com");

    await castVoteFromForm(db, member.id, take.id, formData({ keeper: "true" }), 1000);
    const second = await castVoteFromForm(
      db,
      member.id,
      take.id,
      formData({ keeper: "false" }),
      2000,
    );

    expect(second.kind).toBe("ok");
    if (second.kind === "ok") {
      expect(second.tally.totalVotes).toBe(1);
      expect(second.tally.keeperVotes).toBe(0);
    }
  });
});

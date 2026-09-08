// `/me` composition logic: the member, their instruments, the votes they have
// cast and the count of takes they have not — against a real test database.
//
// Sessions and favourites came off this page (see `me.ts`'s header for why), so
// the tests that covered the current-session marking and the favourites split
// went with them. The favourites split itself is still tested — it moved to
// `home.test.ts` along with the code, where the pinned list now lives.
import type { Db } from "@bandplate/db";
import {
  eventsRepo,
  instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getMeData } from "./me.js";

describe("getMeData", () => {
  let db: Db;
  let memberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const member = await membersRepo.create(db, {
      displayName: "Me Test Member",
      slug: "me-test-member",
      email: "me-test-member@example.com",
      createdAt: Date.now(),
    });
    memberId = member.id;
  });

  it("returns undefined for an unknown member id", async () => {
    const result = await getMeData(db, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeUndefined();
  });

  it("empty votes and a zero count on a fresh member — real empty states, not omissions", async () => {
    const data = await getMeData(db, memberId);
    expect(data?.votes).toEqual([]);
    expect(data?.unvotedCount).toBe(0);
  });

  it("votes so far pairs each vote with its take (song/event/instruments attached)", async () => {
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Voted Song",
      slug: "voted-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await votesRepo.castVote(db, { takeId: take.id, memberId, keeper: true, comment: "nice", now });

    const data = await getMeData(db, memberId);
    expect(data?.votes).toHaveLength(1);
    expect(data?.votes[0]?.vote.keeper).toBe(true);
    expect(data?.votes[0]?.vote.comment).toBe("nice");
    expect(data?.votes[0]?.take?.song?.slug).toBe("voted-song");
  });

  it("counts the published takes this member has not voted on, and stops counting one once they do", async () => {
    // The number that replaced home's "needs your vote" queue. It has to move
    // when a vote is cast, or it is a stale nag on the one page that exists to
    // tell you where you stand.
    const now = Date.now();
    const song = await songsRepo.create(db, {
      title: "Unvoted Song",
      slug: "unvoted-song",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const takes = [];
    for (let i = 0; i < 2; i++) {
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: now + i,
        state: "published",
        createdAt: now,
        updatedAt: now,
      });
      takes.push(take);
    }

    expect((await getMeData(db, memberId))?.unvotedCount).toBe(2);

    await votesRepo.castVote(db, {
      takeId: takes[0]?.id ?? "",
      memberId,
      keeper: true,
      comment: null,
      now,
    });
    expect((await getMeData(db, memberId))?.unvotedCount).toBe(1);
  });

  // Data-model gap, closed via `memberInstruments` — see its schema comment.
  it("returns the member's instruments, including an archived one", async () => {
    const drums = await instrumentsRepo.create(db, { slug: "drums", label: "Drums" });
    const trombone = await instrumentsRepo.create(db, { slug: "trombone", label: "Trombone" });
    await membersRepo.setInstruments(db, memberId, [drums.id, trombone.id]);
    await instrumentsRepo.archive(db, trombone.id, Date.now());

    const data = await getMeData(db, memberId);
    expect(data?.instruments.map((i) => i.id)).toEqual([drums.id, trombone.id]);
    expect(data?.instruments.find((i) => i.id === trombone.id)?.archivedAt).not.toBeNull();
  });
});

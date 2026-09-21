// Home must render when recording the visit fails. Its own file because the
// failure is injected with `vi.mock`, which is hoisted and applies to every
// test in the file: `home.test.ts` needs the real write.
import type { Db } from "@bandplate/db";
import { eventsRepo, membersRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHomeData } from "./home.js";

vi.mock("@bandplate/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@bandplate/db")>();
  return {
    ...original,
    membersRepo: {
      ...original.membersRepo,
      recordHomeLoad: vi.fn(async () => {
        throw new Error("D1 is having a day");
      }),
    },
  };
});

describe("getHomeData when the visit write throws", () => {
  let db: Db;
  let memberId: string;
  const NOW = Date.UTC(2026, 8, 21, 18, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(async () => {
    db = await createTestDb();
    const member = await membersRepo.create(db, {
      displayName: "Unlucky",
      slug: "unlucky",
      email: "unlucky@example.com",
      createdAt: NOW - 400 * DAY,
    });
    memberId = member.id;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("still renders every section, measured from the baseline it read", async () => {
    const song = await songsRepo.create(db, { title: "S", slug: "s", createdAt: 1, updatedAt: 1 });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: NOW - 2 * DAY,
      createdAt: NOW - 2 * DAY,
      updatedAt: NOW - 2 * DAY,
    });
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: NOW - 2 * DAY,
      createdAt: NOW - 2 * DAY,
      updatedAt: NOW - 2 * DAY,
    });
    await takesRepo.setStateWithPublishedAt(db, take.id, "published", NOW - DAY, NOW - DAY);

    const data = await getHomeData(db, memberId, NOW);

    expect(membersRepo.recordHomeLoad).toHaveBeenCalledOnce();
    expect(data.onTheStand?.event.id).toBe(event.id);
    expect(data.recentEvents.map((e) => e.id)).toEqual([event.id]);
    expect(console.error).toHaveBeenCalledWith(
      "failed to record the home visit",
      memberId,
      expect.any(Error),
    );
    // Nothing was written, so the next load still sees a first visit.
    expect((await membersRepo.getById(db, memberId))?.homeLastSeenAt).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as members from "./members.js";
import * as notificationPrefs from "./notification-prefs.js";

describe("notificationPrefsRepo", () => {
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

  it("get returns the defaults (all on) when no row exists", async () => {
    const member = await createMember("prefs-1");
    expect(await notificationPrefs.get(db, member.id)).toEqual(
      notificationPrefs.DEFAULT_NOTIFICATION_PREFS,
    );
  });

  it("set then get round-trips a member's choices", async () => {
    const member = await createMember("prefs-2");
    await notificationPrefs.set(
      db,
      member.id,
      { newTakes: false, weeklyUnvoted: true, songChanges: false },
      1000,
    );

    expect(await notificationPrefs.get(db, member.id)).toEqual({
      newTakes: false,
      weeklyUnvoted: true,
      songChanges: false,
    });
  });

  it("set upserts — a second call overwrites rather than duplicating", async () => {
    const member = await createMember("prefs-3");
    await notificationPrefs.set(
      db,
      member.id,
      { newTakes: false, weeklyUnvoted: false, songChanges: false },
      1000,
    );
    await notificationPrefs.set(
      db,
      member.id,
      { newTakes: true, weeklyUnvoted: true, songChanges: true },
      2000,
    );

    expect(await notificationPrefs.get(db, member.id)).toEqual({
      newTakes: true,
      weeklyUnvoted: true,
      songChanges: true,
    });
  });

  it("listForMembers returns only rows that exist, keyed by member id", async () => {
    const memberA = await createMember("prefs-4a");
    const memberB = await createMember("prefs-4b");
    await notificationPrefs.set(
      db,
      memberA.id,
      { newTakes: false, weeklyUnvoted: false, songChanges: false },
      1000,
    );

    const result = await notificationPrefs.listForMembers(db, [memberA.id, memberB.id]);

    expect(result.size).toBe(1);
    expect(result.get(memberA.id)).toEqual({
      newTakes: false,
      weeklyUnvoted: false,
      songChanges: false,
    });
    expect(result.has(memberB.id)).toBe(false);
  });

  it("listForMembers returns an empty map for an empty member list", async () => {
    expect((await notificationPrefs.listForMembers(db, [])).size).toBe(0);
  });

  // Fix round 1, finding 1: a companion regression test — this query's
  // `inArray(...)` really is its only bound value (unlike
  // `takesRepo.countUnvotedByMembers`'s), so a full 100-id chunk is exactly
  // at the cap, not over it.
  it("a full chunk's query stays at or under D1's 100-parameter limit", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `member-${i}`);
    const query = notificationPrefs.buildListForMembersChunkQuery(db, ids);
    expect(query.toSQL().params.length).toBeLessThanOrEqual(100);
  });
});

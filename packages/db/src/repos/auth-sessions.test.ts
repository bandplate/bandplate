import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { members as membersTable } from "../schema/sqlite/index.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as authSessions from "./auth-sessions.js";
import * as members from "./members.js";

describe("auth-sessions repo", () => {
  let db: Db;
  let memberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const member = await members.create(db, {
      displayName: "Alex",
      slug: "alex",
      email: "alex@example.com",
      status: "invited",
      createdAt: 1_000,
    });
    memberId = member.id;
  });

  it("create stores a session not revoked", async () => {
    const session = await authSessions.create(db, {
      memberId,
      tokenHash: "hash-1",
      createdAt: 1_000,
      expiresAt: 2_000,
    });
    expect(session.revokedAt).toBeNull();
    expect(session.lastSeenAt).toBe(1_000);
  });

  it("createFromLogin without activation leaves the member untouched", async () => {
    await authSessions.createFromLogin(db, {
      memberId,
      tokenHash: "hash-1",
      createdAt: 1_000,
      expiresAt: 2_000,
    });

    const member = await members.getById(db, memberId);
    expect(member?.status).toBe("invited");
    expect(member?.emailVerifiedAt).toBeNull();
  });

  it("createFromLogin with activation flips the member to active in the same write", async () => {
    await authSessions.createFromLogin(db, {
      memberId,
      tokenHash: "hash-1",
      createdAt: 1_000,
      expiresAt: 2_000,
      activateMemberAt: 1_234,
    });

    const member = await members.getById(db, memberId);
    const session = await authSessions.getByHash(db, "hash-1");

    expect(member?.status).toBe("active");
    expect(member?.emailVerifiedAt).toBe(1_234);
    expect(session).not.toBeUndefined();
  });

  it("touch extends lastSeenAt and expiresAt", async () => {
    const session = await authSessions.create(db, {
      memberId,
      tokenHash: "hash-1",
      createdAt: 1_000,
      expiresAt: 2_000,
    });

    await authSessions.touch(db, session.id, { lastSeenAt: 5_000, expiresAt: 9_000 });
    const refreshed = await authSessions.getByHash(db, "hash-1");

    expect(refreshed?.lastSeenAt).toBe(5_000);
    expect(refreshed?.expiresAt).toBe(9_000);
  });

  it("revoke sets revokedAt", async () => {
    const session = await authSessions.create(db, {
      memberId,
      tokenHash: "hash-1",
      createdAt: 1_000,
      expiresAt: 2_000,
    });

    await authSessions.revoke(db, session.id, 3_000);
    const revoked = await authSessions.getByHash(db, "hash-1");

    expect(revoked?.revokedAt).toBe(3_000);
  });

  it("revokeAllForMember revokes every active session for that member only", async () => {
    const other = await members.create(db, {
      displayName: "Sam",
      slug: "sam",
      email: "sam@example.com",
      createdAt: 1_000,
    });

    await authSessions.create(db, {
      memberId,
      tokenHash: "hash-a",
      createdAt: 1_000,
      expiresAt: 2_000,
    });
    await authSessions.create(db, {
      memberId,
      tokenHash: "hash-b",
      createdAt: 1_000,
      expiresAt: 2_000,
    });
    await authSessions.create(db, {
      memberId: other.id,
      tokenHash: "hash-c",
      createdAt: 1_000,
      expiresAt: 2_000,
    });

    await authSessions.revokeAllForMember(db, memberId, 5_000);

    const a = await authSessions.getByHash(db, "hash-a");
    const b = await authSessions.getByHash(db, "hash-b");
    const c = await authSessions.getByHash(db, "hash-c");

    expect(a?.revokedAt).toBe(5_000);
    expect(b?.revokedAt).toBe(5_000);
    expect(c?.revokedAt).toBeNull();
  });

  describe("listByMember", () => {
    it("lists only that member's sessions, most recently active first", async () => {
      const other = await members.create(db, {
        displayName: "Sam",
        slug: "sam",
        email: "sam@example.com",
        createdAt: 1_000,
      });

      const older = await authSessions.create(db, {
        memberId,
        tokenHash: "hash-older",
        createdAt: 1_000,
        expiresAt: 9_000,
      });
      await authSessions.touch(db, older.id, { lastSeenAt: 2_000, expiresAt: 9_000 });
      const newer = await authSessions.create(db, {
        memberId,
        tokenHash: "hash-newer",
        createdAt: 1_000,
        expiresAt: 9_000,
      });
      await authSessions.touch(db, newer.id, { lastSeenAt: 5_000, expiresAt: 9_000 });
      await authSessions.create(db, {
        memberId: other.id,
        tokenHash: "hash-other-member",
        createdAt: 1_000,
        expiresAt: 9_000,
      });

      const result = await authSessions.listByMember(db, memberId);

      expect(result.map((s) => s.id)).toEqual([newer.id, older.id]);
    });

    it("includes a revoked session (a display listing, not an auth check)", async () => {
      const session = await authSessions.create(db, {
        memberId,
        tokenHash: "hash-revoked",
        createdAt: 1_000,
        expiresAt: 9_000,
      });
      await authSessions.revoke(db, session.id, 3_000);

      const result = await authSessions.listByMember(db, memberId);

      expect(result.map((s) => s.id)).toContain(session.id);
    });

    it("returns an empty array for a member with no sessions", async () => {
      const untouched = await members.create(db, {
        displayName: "Never Logged In",
        slug: "never-listbymember",
        email: "never-listbymember@example.com",
        createdAt: 1_000,
      });

      const result = await authSessions.listByMember(db, untouched.id);

      expect(result).toEqual([]);
    });
  });

  describe("getLastSeenAtByMember", () => {
    it("returns the max lastSeenAt per member across multiple sessions, excluding members with none", async () => {
      const other = await members.create(db, {
        displayName: "Sam",
        slug: "sam",
        email: "sam@example.com",
        createdAt: 1_000,
      });
      const untouched = await members.create(db, {
        displayName: "Never Logged In",
        slug: "never",
        email: "never@example.com",
        createdAt: 1_000,
      });

      const earlySession = await authSessions.create(db, {
        memberId,
        tokenHash: "hash-early",
        createdAt: 1_000,
        expiresAt: 2_000,
      });
      await authSessions.touch(db, earlySession.id, { lastSeenAt: 3_000, expiresAt: 9_000 });
      await authSessions.create(db, {
        memberId,
        tokenHash: "hash-late",
        createdAt: 5_000,
        expiresAt: 9_000,
      });
      await authSessions.create(db, {
        memberId: other.id,
        tokenHash: "hash-other",
        createdAt: 4_000,
        expiresAt: 9_000,
      });

      const result = await authSessions.getLastSeenAtByMember(db);

      expect(result.get(memberId)).toBe(5_000);
      expect(result.get(other.id)).toBe(4_000);
      expect(result.has(untouched.id)).toBe(false);
    });
  });

  describe("buildCreateIfMemberExistsStatement", () => {
    it("inserts the session when the referenced member exists", async () => {
      const { statement } = authSessions.buildCreateIfMemberExistsStatement(db, {
        memberId,
        tokenHash: "hash-guarded",
        createdAt: 1_000,
        expiresAt: 2_000,
      });
      await statement;

      const session = await authSessions.getByHash(db, "hash-guarded");
      expect(session).not.toBeUndefined();
      expect(session?.memberId).toBe(memberId);
    });

    it("is a no-op when the referenced member does not exist", async () => {
      const { statement } = authSessions.buildCreateIfMemberExistsStatement(db, {
        memberId: "00000000-0000-0000-0000-000000000000",
        tokenHash: "hash-orphan",
        createdAt: 1_000,
        expiresAt: 2_000,
      });
      await statement;

      const session = await authSessions.getByHash(db, "hash-orphan");
      expect(session).toBeUndefined();
    });

    it("works as one of multiple statements inside a single db.batch", async () => {
      const { statement } = authSessions.buildCreateIfMemberExistsStatement(db, {
        memberId,
        tokenHash: "hash-batched",
        createdAt: 1_000,
        expiresAt: 2_000,
      });

      await db.batch([statement, db.select().from(membersTable)]);

      const session = await authSessions.getByHash(db, "hash-batched");
      expect(session).not.toBeUndefined();
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as loginTokens from "./login-tokens.js";
import * as members from "./members.js";

describe("login-tokens repo", () => {
  let db: Db;
  let memberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const member = await members.create(db, {
      displayName: "Alex",
      slug: "alex",
      email: "alex@example.com",
      createdAt: 1_000,
    });
    memberId = member.id;
  });

  it("create stores the row unused with the given expiry", async () => {
    const token = await loginTokens.create(db, {
      memberId,
      tokenHash: "hash-1",
      expiresAt: 2_000,
      createdAt: 1_000,
    });
    expect(token.usedAt).toBeNull();
    expect(token.expiresAt).toBe(2_000);
  });

  it("getByHash finds the row and does not mutate it", async () => {
    await loginTokens.create(db, {
      memberId,
      tokenHash: "hash-1",
      expiresAt: 2_000,
      createdAt: 1_000,
    });

    await loginTokens.getByHash(db, "hash-1");
    const stillUnused = await loginTokens.getByHash(db, "hash-1");

    expect(stillUnused?.usedAt).toBeNull();
  });

  it("consume marks an unused, unexpired token used and returns it", async () => {
    await loginTokens.create(db, {
      memberId,
      tokenHash: "hash-1",
      expiresAt: 2_000,
      createdAt: 1_000,
    });

    const consumed = await loginTokens.consume(db, { tokenHash: "hash-1", now: 1_500 });

    expect(consumed?.usedAt).toBe(1_500);
  });

  it("consume refuses a second attempt on the same token", async () => {
    await loginTokens.create(db, {
      memberId,
      tokenHash: "hash-1",
      expiresAt: 2_000,
      createdAt: 1_000,
    });

    const first = await loginTokens.consume(db, { tokenHash: "hash-1", now: 1_500 });
    const second = await loginTokens.consume(db, { tokenHash: "hash-1", now: 1_600 });

    expect(first).not.toBeUndefined();
    expect(second).toBeUndefined();
  });

  it("consume refuses an expired token", async () => {
    await loginTokens.create(db, {
      memberId,
      tokenHash: "hash-1",
      expiresAt: 2_000,
      createdAt: 1_000,
    });

    const consumed = await loginTokens.consume(db, { tokenHash: "hash-1", now: 2_000 });

    expect(consumed).toBeUndefined();
  });

  it("consume refuses an unknown token hash", async () => {
    const consumed = await loginTokens.consume(db, { tokenHash: "nope", now: 1_500 });
    expect(consumed).toBeUndefined();
  });
});

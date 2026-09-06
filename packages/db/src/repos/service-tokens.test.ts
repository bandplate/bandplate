import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as serviceTokens from "./service-tokens.js";

describe("service-tokens repo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("create stores scopes and leaves lastUsedAt/revokedAt unset", async () => {
    const token = await serviceTokens.create(db, {
      label: "ingest bot",
      tokenHash: "hash-1",
      scopes: ["ingest:write"],
      createdAt: 1_000,
    });

    expect(token.scopes).toEqual(["ingest:write"]);
    expect(token.lastUsedAt).toBeNull();
    expect(token.revokedAt).toBeNull();
  });

  it("setScopes replaces the scope list", async () => {
    const token = await serviceTokens.create(db, {
      label: "ingest bot",
      tokenHash: "hash-1",
      scopes: ["ingest:write"],
      createdAt: 1_000,
    });

    await serviceTokens.setScopes(db, token.id, ["ingest:write", "takes:read"]);
    const updated = await serviceTokens.getById(db, token.id);

    expect(updated?.scopes).toEqual(["ingest:write", "takes:read"]);
  });

  it("revoke sets revokedAt", async () => {
    const token = await serviceTokens.create(db, {
      label: "ingest bot",
      tokenHash: "hash-1",
      scopes: ["ingest:write"],
      createdAt: 1_000,
    });

    await serviceTokens.revoke(db, token.id, 2_000);
    const revoked = await serviceTokens.getById(db, token.id);

    expect(revoked?.revokedAt).toBe(2_000);
  });

  it("touchLastUsed updates lastUsedAt", async () => {
    const token = await serviceTokens.create(db, {
      label: "ingest bot",
      tokenHash: "hash-1",
      scopes: ["ingest:write"],
      createdAt: 1_000,
    });

    await serviceTokens.touchLastUsed(db, token.id, 3_000);
    const touched = await serviceTokens.getById(db, token.id);

    expect(touched?.lastUsedAt).toBe(3_000);
  });

  it("list returns every token", async () => {
    await serviceTokens.create(db, { label: "a", tokenHash: "h1", scopes: [], createdAt: 1_000 });
    await serviceTokens.create(db, { label: "b", tokenHash: "h2", scopes: [], createdAt: 1_000 });

    const all = await serviceTokens.list(db);
    expect(all).toHaveLength(2);
  });
});

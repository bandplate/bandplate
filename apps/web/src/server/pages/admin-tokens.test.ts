import { type AuthDeps, systemClock } from "@bandlib/core";
import { createTestDb } from "@bandlib/db/testing";
import { createNullMailer } from "@bandlib/mail";
import { beforeEach, describe, expect, it } from "vitest";
import { createToken, listTokens, revokeToken, updateTokenScopes } from "./admin-tokens.js";

function formData(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else {
      fd.set(key, value);
    }
  }
  return fd;
}

describe("admin tokens page logic", () => {
  let auth: AuthDeps;

  beforeEach(async () => {
    const db = await createTestDb();
    auth = { db, mailer: createNullMailer(), clock: systemClock };
  });

  it("creates a token and returns the raw secret exactly once, never persisted", async () => {
    const result = await createToken(
      auth,
      formData({ label: "reaper-bridge", scopes: ["ingest:write"] }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.rawToken).toMatch(/^blk_/);
    }

    const tokens = await listTokens(auth.db);
    expect(tokens).toHaveLength(1);
    // The public listing must never carry the raw secret or its hash.
    expect(tokens[0]).not.toHaveProperty("tokenHash");
    expect(tokens[0]).not.toHaveProperty("rawToken");
  });

  it("rejects a token created with zero scopes, tagging the scopes field", async () => {
    const result = await createToken(auth, formData({ label: "empty", scopes: [] }));
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.field).toBe("scopes");
    }
  });

  it("rejects a token created with an empty label, tagging the label field", async () => {
    const result = await createToken(auth, formData({ label: "", scopes: ["ingest:write"] }));
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.field).toBe("label");
    }
  });

  it("updates scopes for an existing token", async () => {
    await createToken(auth, formData({ label: "reaper-bridge", scopes: ["ingest:write"] }));
    const [token] = await listTokens(auth.db);
    if (!token) throw new Error("expected a token");

    const result = await updateTokenScopes(
      auth.db,
      token.id,
      formData({ scopes: ["ingest:write", "takes:read"] }),
    );
    expect(result.kind).toBe("ok");

    const [updated] = await listTokens(auth.db);
    expect(updated?.scopes.sort()).toEqual(["ingest:write", "takes:read"].sort());
  });

  it("revokes a token", async () => {
    await createToken(auth, formData({ label: "reaper-bridge", scopes: ["ingest:write"] }));
    const [token] = await listTokens(auth.db);
    if (!token) throw new Error("expected a token");

    const result = await revokeToken(auth.db, token.id, 5_000);
    expect(result.kind).toBe("ok");

    const [revoked] = await listTokens(auth.db);
    expect(revoked?.revokedAt).toBe(5_000);
  });

  it("reports not_found for an unknown token id", async () => {
    const result = await revokeToken(auth.db, "00000000-0000-0000-0000-000000000000", 1_000);
    expect(result.kind).toBe("not_found");
  });
});

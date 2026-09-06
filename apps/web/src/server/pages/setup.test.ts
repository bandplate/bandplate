// `/setup`: form-post bootstrap flow, exercised via the exact functions the
// `setup.astro` page's frontmatter calls.
import { type AuthDeps, systemClock } from "@bandlib/core";
import { createTestDb } from "@bandlib/db/testing";
import { createNullMailer } from "@bandlib/mail";
import { beforeEach, describe, expect, it } from "vitest";
import { handleSetupPost, isBootstrapAvailable } from "./setup.js";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

describe("setup page logic", () => {
  let auth: AuthDeps;

  beforeEach(async () => {
    const db = await createTestDb();
    auth = { db, mailer: createNullMailer(), clock: systemClock, bootstrapToken: "correct-token" };
  });

  it("reports bootstrap available on an empty database", async () => {
    expect(await isBootstrapAvailable(auth.db)).toBe(true);
  });

  it("rejects a missing bootstrap token field with a field-level error, without throwing", async () => {
    const result = await handleSetupPost(
      auth,
      formData({ bootstrapToken: "", displayName: "Alex", email: "alex@example.com" }),
    );
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors.bootstrapToken).toBeTruthy();
    }
  });

  it("rejects the wrong bootstrap token and creates no member", async () => {
    const result = await handleSetupPost(
      auth,
      formData({ bootstrapToken: "wrong", displayName: "Alex", email: "alex@example.com" }),
    );
    expect(result.kind).toBe("bad_token");

    const { membersRepo } = await import("@bandlib/db");
    expect(await membersRepo.count(auth.db)).toBe(0);
  });

  it("bootstraps the first admin with the correct token and reports bootstrap unavailable afterward", async () => {
    const result = await handleSetupPost(
      auth,
      formData({ bootstrapToken: "correct-token", displayName: "Alex", email: "alex@example.com" }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.sessionToken).toEqual(expect.any(String));
    }
    expect(await isBootstrapAvailable(auth.db)).toBe(false);
  });

  it("404s (already_bootstrapped) on a second bootstrap attempt", async () => {
    await handleSetupPost(
      auth,
      formData({ bootstrapToken: "correct-token", displayName: "Alex", email: "alex@example.com" }),
    );
    const second = await handleSetupPost(
      auth,
      formData({ bootstrapToken: "correct-token", displayName: "Sam", email: "sam@example.com" }),
    );
    expect(second.kind).toBe("already_bootstrapped");
  });
});

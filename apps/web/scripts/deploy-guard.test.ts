// Pure decisions for `pnpm ship` (apps/web/scripts/deploy.ts) and CI's
// `deploy` job — kept here, node-testable, and separate from the
// process-spawning script so they never need `wrangler` or `git` running
// to verify.
import { describe, expect, it } from "vitest";
import { isHeadPushed, isTreeClean, pendingMigrationsGuardMessage } from "./deploy-guard.js";

describe("isTreeClean", () => {
  it("is clean for empty porcelain output", () => {
    expect(isTreeClean("")).toBe(true);
  });

  it("is clean for output that is only whitespace", () => {
    expect(isTreeClean("\n")).toBe(true);
  });

  it("is dirty when a file is modified", () => {
    expect(isTreeClean(" M apps/web/src/server/config.worker.ts\n")).toBe(false);
  });

  it("is dirty for an untracked file", () => {
    expect(isTreeClean("?? scratch.txt\n")).toBe(false);
  });
});

describe("isHeadPushed", () => {
  it("is pushed when HEAD and origin/main match", () => {
    const sha = "abc123def456";
    expect(isHeadPushed(`${sha}\n`, `${sha}\n`)).toBe(true);
  });

  it("is not pushed when they differ", () => {
    expect(isHeadPushed("abc123\n", "def456\n")).toBe(false);
  });

  it("is not pushed when HEAD is empty", () => {
    expect(isHeadPushed("\n", "def456\n")).toBe(false);
  });

  it("is not pushed when origin/main is empty", () => {
    expect(isHeadPushed("abc123\n", "")).toBe(false);
  });
});

describe("pendingMigrationsGuardMessage", () => {
  it("is null when nothing is pending", () => {
    expect(pendingMigrationsGuardMessage([])).toBeNull();
  });

  it("names the pending migrations and says to run pnpm migrate:remote first", () => {
    const message = pendingMigrationsGuardMessage(["0012_add_foo.sql", "0013_add_bar.sql"]);
    expect(message).toContain("0012_add_foo.sql");
    expect(message).toContain("0013_add_bar.sql");
    expect(message).toContain("pnpm migrate:remote first");
  });
});

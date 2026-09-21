import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildErrorLogRecord, describeError, type LogErrorInput, logError } from "./log-error.js";

describe("buildErrorLogRecord", () => {
  it("builds the minimal record from kind + message", () => {
    expect(buildErrorLogRecord({ kind: "page", message: "boom" })).toEqual({
      level: "error",
      kind: "page",
      message: "boom",
    });
  });

  it("keeps route when given", () => {
    expect(buildErrorLogRecord({ kind: "page", message: "boom", route: "/takes/1" })).toEqual({
      level: "error",
      kind: "page",
      message: "boom",
      route: "/takes/1",
    });
  });

  it("redacts the sign-in token off an Astro /login/:token route", () => {
    const record = buildErrorLogRecord({
      kind: "page",
      message: "boom",
      route: "/login/eyJhbGciOiJIUzI1NiJ9.super-secret-token",
    });
    expect(record.route).toBe("/login/:token");
  });

  it("redacts the sign-in token off an API /auth/login/:token route", () => {
    const record = buildErrorLogRecord({
      kind: "api",
      message: "boom",
      route: "/auth/login/super-secret-token",
    });
    expect(record.route).toBe("/auth/login/:token");
  });

  it("drops the query string from route entirely", () => {
    const record = buildErrorLogRecord({
      kind: "api",
      message: "boom",
      route: "/songs/my-song?token=super-secret-token&utm=1",
    });
    expect(record.route).toBe("/songs/my-song");
  });

  it("redacts the token AND drops the query string when a route has both", () => {
    const record = buildErrorLogRecord({
      kind: "page",
      message: "boom",
      route: "/login/super-secret-token?redirect=/me",
    });
    expect(record.route).toBe("/login/:token");
  });

  it("leaves a route with no login segment and no query string unchanged", () => {
    const record = buildErrorLogRecord({ kind: "page", message: "boom", route: "/takes/1" });
    expect(record.route).toBe("/takes/1");
  });

  it("leaves a bare /login (no token segment) unchanged", () => {
    const record = buildErrorLogRecord({ kind: "page", message: "boom", route: "/login" });
    expect(record.route).toBe("/login");
  });

  it("keeps cron when given", () => {
    expect(
      buildErrorLogRecord({ kind: "scheduled-tick", message: "boom", cron: "*/10 * * * *" }),
    ).toEqual({
      level: "error",
      kind: "scheduled-tick",
      message: "boom",
      cron: "*/10 * * * *",
    });
  });

  it("keeps a short stack verbatim", () => {
    const record = buildErrorLogRecord({
      kind: "api",
      message: "boom",
      stack: "Error: boom\n  at x",
    });
    expect(record.stack).toBe("Error: boom\n  at x");
  });

  it("truncates a stack over 2 KB to 2 KB (including the truncation marker)", () => {
    const hugeStack = "x".repeat(5000);
    const record = buildErrorLogRecord({ kind: "api", message: "boom", stack: hugeStack });
    expect(record.stack).toBeDefined();
    expect(new TextEncoder().encode(record.stack as string).length).toBeLessThanOrEqual(2048);
    expect(record.stack).toMatch(/truncated/i);
    // Not silently identical to a naive slice — the marker must actually be present.
    expect(record.stack).not.toBe(hugeStack.slice(0, 2048));
  });

  it("drops fields that are not part of the record shape", () => {
    const input = {
      kind: "api",
      message: "boom",
      extra: "should not appear",
      requestId: "abc-123",
    } as unknown as LogErrorInput;
    const record = buildErrorLogRecord(input);
    expect(record).toEqual({ level: "error", kind: "api", message: "boom" });
    expect(Object.keys(record)).not.toContain("extra");
    expect(Object.keys(record)).not.toContain("requestId");
  });

  it("never includes a cookie value, even when the input carries one", () => {
    const input = {
      kind: "api",
      message: "boom",
      cookie: "bp_session=super-secret-value",
    } as unknown as LogErrorInput;
    const record = buildErrorLogRecord(input);
    expect(JSON.stringify(record)).not.toContain("super-secret-value");
    expect(Object.keys(record)).not.toContain("cookie");
  });

  it("never includes an authorization value, even when the input carries one", () => {
    const input = {
      kind: "api",
      message: "boom",
      authorization: "Bearer super-secret-token",
    } as unknown as LogErrorInput;
    const record = buildErrorLogRecord(input);
    expect(JSON.stringify(record)).not.toContain("super-secret-token");
    expect(Object.keys(record)).not.toContain("authorization");
  });
});

describe("describeError", () => {
  it("pulls message and stack off an Error", () => {
    const err = new Error("boom");
    const { message, stack } = describeError(err);
    expect(message).toBe("boom");
    expect(stack).toBe(err.stack);
  });

  it("stringifies a non-Error throw and has no stack", () => {
    expect(describeError("plain string")).toEqual({ message: "plain string" });
    expect(describeError(42)).toEqual({ message: "42" });
  });
});

describe("logError", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("calls console.error exactly once with a single JSON string argument", () => {
    logError({ kind: "page", message: "boom", route: "/takes/1" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toHaveLength(1);
    const [line] = errorSpy.mock.calls[0] as [string];
    expect(typeof line).toBe("string");
    expect(JSON.parse(line)).toEqual({
      level: "error",
      kind: "page",
      message: "boom",
      route: "/takes/1",
    });
  });
});

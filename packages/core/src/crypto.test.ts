import { describe, expect, it } from "vitest";
import { generateToken, hashToken, timingSafeEqualHex } from "./crypto.js";

describe("generateToken", () => {
  it("returns a base64url string with no padding characters", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("=");
  });

  it("returns a different token on every call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});

describe("hashToken", () => {
  it("returns the known SHA-256 hex digest for a fixed input", async () => {
    // echo -n "hello" | sha256sum
    expect(await hashToken("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is deterministic for the same input", async () => {
    const a = await hashToken("some-raw-token");
    const b = await hashToken("some-raw-token");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", async () => {
    const a = await hashToken("token-a");
    const b = await hashToken("token-b");
    expect(a).not.toBe(b);
  });
});

describe("timingSafeEqualHex", () => {
  it("returns true for identical hex strings", () => {
    expect(timingSafeEqualHex("abcd1234", "abcd1234")).toBe(true);
  });

  it("returns false when strings differ only in the last character", () => {
    expect(timingSafeEqualHex("abcd1234", "abcd1235")).toBe(false);
  });

  it("returns false when strings differ only in the first character", () => {
    expect(timingSafeEqualHex("abcd1234", "bbcd1234")).toBe(false);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(timingSafeEqualHex("abcd", "abcd12")).toBe(false);
  });
});

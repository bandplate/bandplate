import { describe, expect, it } from "vitest";
import { generateVapidKeys, validateVapidConfig, vapidKeyId } from "./vapid.js";

describe("generateVapidKeys", () => {
  it("returns a publicKey/privateKey pair that validateVapidConfig accepts", async () => {
    const keys = await generateVapidKeys();
    const problems = validateVapidConfig({ ...keys, subject: "mailto:ops@example.com" });
    expect(problems).toEqual([]);
  });

  it("returns an 87-char base64url publicKey (base64url of the 65-byte uncompressed P-256 point)", async () => {
    const { publicKey } = await generateVapidKeys();
    expect(publicKey).toHaveLength(87);
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a 43-char base64url privateKey (base64url of the raw 32-byte scalar d)", async () => {
    const { privateKey } = await generateVapidKeys();
    expect(privateKey).toHaveLength(43);
    expect(privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a fresh pair on every call", async () => {
    const a = await generateVapidKeys();
    const b = await generateVapidKeys();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

describe("validateVapidConfig", () => {
  it("rejects a publicKey of the wrong length", async () => {
    const { privateKey } = await generateVapidKeys();
    const problems = validateVapidConfig({
      publicKey: "too-short",
      privateKey,
      subject: "mailto:ops@example.com",
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => /publicKey/.test(p))).toBe(true);
  });

  it("rejects a privateKey of the wrong length", async () => {
    const { publicKey } = await generateVapidKeys();
    const problems = validateVapidConfig({
      publicKey,
      privateKey: "too-short",
      subject: "mailto:ops@example.com",
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => /privateKey/.test(p))).toBe(true);
  });

  it("rejects a publicKey with non-base64url characters even at the right length", async () => {
    const { publicKey, privateKey } = await generateVapidKeys();
    const corrupted = `${publicKey.slice(0, -1)}+`;
    const problems = validateVapidConfig({
      publicKey: corrupted,
      privateKey,
      subject: "mailto:ops@example.com",
    });
    expect(problems.some((p) => /publicKey/.test(p))).toBe(true);
  });

  it("rejects a subject that isn't mailto: or https:", async () => {
    const { publicKey, privateKey } = await generateVapidKeys();
    const problems = validateVapidConfig({
      publicKey,
      privateKey,
      subject: "ops@example.com",
    });
    expect(problems.some((p) => /subject/.test(p))).toBe(true);
  });

  it("accepts an https: subject", async () => {
    const { publicKey, privateKey } = await generateVapidKeys();
    const problems = validateVapidConfig({
      publicKey,
      privateKey,
      subject: "https://example.com/contact",
    });
    expect(problems).toEqual([]);
  });

  it("reports every problem at once, not just the first", () => {
    const problems = validateVapidConfig({
      publicKey: "bad",
      privateKey: "bad",
      subject: "bad",
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("vapidKeyId", () => {
  it("is the first 16 characters of the public key", async () => {
    const { publicKey } = await generateVapidKeys();
    expect(vapidKeyId(publicKey)).toBe(publicKey.slice(0, 16));
    expect(vapidKeyId(publicKey)).toHaveLength(16);
  });
});

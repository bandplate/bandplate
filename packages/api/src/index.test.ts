import { describe, expect, it } from "vitest";
import { buildTestApp } from "./test-helpers.js";

describe("createApp", () => {
  it("GET /health returns 200 with { ok: true }", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /health requires no Origin header (not a mutating method)", async () => {
    const { app } = await buildTestApp();
    const res = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });
});

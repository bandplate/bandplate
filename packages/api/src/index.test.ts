import { describe, expect, it } from "vitest";
import { createApp } from "./index.js";

describe("createApp", () => {
  it("GET /health returns 200 with { ok: true }", async () => {
    const app = createApp();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect.js";

const APP_ORIGIN = "https://band.example";

describe("safeRedirectPath", () => {
  it("returns the path+search of a same-origin Referer", () => {
    expect(safeRedirectPath("https://band.example/search?q=neon", APP_ORIGIN, "/")).toBe(
      "/search?q=neon",
    );
  });

  it("falls back when there is no Referer header", () => {
    expect(safeRedirectPath(null, APP_ORIGIN, "/fallback")).toBe("/fallback");
  });

  it("falls back for a cross-origin Referer — never an open redirect", () => {
    expect(safeRedirectPath("https://evil.example/steal-session", APP_ORIGIN, "/fallback")).toBe(
      "/fallback",
    );
  });

  it("falls back for a garbage Referer that isn't a valid URL", () => {
    expect(safeRedirectPath("not a url", APP_ORIGIN, "/fallback")).toBe("/fallback");
  });

  it("falls back for a protocol-relative `//host` path — never an open redirect", () => {
    expect(safeRedirectPath("https://band.example//evil.example/x", APP_ORIGIN, "/fallback")).toBe(
      "/fallback",
    );
  });

  it("falls back for a `///host` path", () => {
    expect(safeRedirectPath("https://band.example///evil.example/x", APP_ORIGIN, "/fallback")).toBe(
      "/fallback",
    );
  });

  it("falls back for a backslash variant the URL parser folds into `//host`", () => {
    expect(
      safeRedirectPath(`https://band.example/${"\\"}evil.example/x`, APP_ORIGIN, "/fallback"),
    ).toBe("/fallback");
  });
});

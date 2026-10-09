import { describe, expect, it } from "vitest";
import {
  loginPathReturningTo,
  safeAppPath,
  safeRedirectPath,
  shareReturnPath,
  withQuery,
} from "./safe-redirect.js";

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

describe("safeAppPath", () => {
  it("keeps a plain app path, query and all", () => {
    expect(safeAppPath("/songs/coudy")).toBe("/songs/coudy");
    expect(safeAppPath("/takes?stash=1")).toBe("/takes?stash=1");
    expect(safeAppPath("  /takes?stash=1  ")).toBe("/takes?stash=1");
  });

  it("refuses anything that is not a path on this app", () => {
    expect(safeAppPath(null)).toBeNull();
    expect(safeAppPath(undefined)).toBeNull();
    expect(safeAppPath("")).toBeNull();
    expect(safeAppPath("   ")).toBeNull();
    // No scheme, and nothing that is one in disguise.
    expect(safeAppPath("https://evil.example/x")).toBeNull();
    expect(safeAppPath("javascript:alert(1)")).toBeNull();
    // Not a path at all: a browser resolves this against the current page.
    expect(safeAppPath("songs/coudy")).toBeNull();
  });

  it("refuses the protocol-relative forms — never an open redirect", () => {
    expect(safeAppPath("//evil.example/x")).toBeNull();
    expect(safeAppPath("///evil.example/x")).toBeNull();
    // The URL parser folds a leading backslash into `/` for special schemes,
    // so `/\evil.example` is `//evil.example` by the time a browser sees it.
    expect(safeAppPath("/\\evil.example/x")).toBeNull();
    expect(safeAppPath("/\\/evil.example/x")).toBeNull();
  });
});

describe("withQuery", () => {
  it("opens the query, then extends it", () => {
    expect(withQuery("/songs/coudy", "published=1")).toBe("/songs/coudy?published=1");
    expect(withQuery("/takes?stash=1", "deleted=t-1")).toBe("/takes?stash=1&deleted=t-1");
  });
});

describe("shareReturnPath", () => {
  it("keeps a share link", () => {
    expect(shareReturnPath("/s/aB3dE7zQ9x")).toBe("/s/aB3dE7zQ9x");
    expect(shareReturnPath(" /s/aB3dE7zQ9x ")).toBe("/s/aB3dE7zQ9x");
  });

  it.each([
    ["any other page", "/songs/coudy"],
    ["home", "/"],
    ["an off-site URL", "https://evil.example/s/aB3dE7zQ9x"],
    ["protocol-relative", "//evil.example/s/aB3dE7zQ9x"],
    ["a code of the wrong length", "/s/abc"],
    ["a trailing path", "/s/aB3dE7zQ9x/x"],
    ["a query", "/s/aB3dE7zQ9x?x=1"],
    ["an encoded slash", "/s/aB3dE7zQ9x%2F"],
    ["nothing", ""],
  ])("refuses %s", (_label, value) => {
    expect(shareReturnPath(value)).toBeNull();
  });

  it("refuses an absent value", () => {
    expect(shareReturnPath(null)).toBeNull();
    expect(shareReturnPath(undefined)).toBeNull();
  });
});

describe("loginPathReturningTo", () => {
  it("is plain /login with nothing to return to", () => {
    expect(loginPathReturningTo(null)).toBe("/login");
  });

  it("carries the share link, encoded", () => {
    expect(loginPathReturningTo("/s/aB3dE7zQ9x")).toBe("/login?next=%2Fs%2FaB3dE7zQ9x");
  });
});

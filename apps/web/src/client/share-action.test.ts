import { generateShareCode } from "@bandplate/core";
import { describe, expect, it } from "vitest";
import {
  afterShareError,
  shareMechanism,
  shareStateFrom,
  shareUrl,
  shortPathFrom,
  tapOpensSheet,
} from "./share-action.js";

const here = { origin: "https://band.example", pathname: "/songs/coudy" };

describe("shareMechanism", () => {
  it("uses the share sheet when the browser has one", () => {
    expect(shareMechanism({ share: () => Promise.resolve() })).toBe("share");
  });

  it("copies when it does not", () => {
    expect(shareMechanism({})).toBe("copy");
    expect(shareMechanism(undefined)).toBe("copy");
    expect(shareMechanism({ share: "not a function" })).toBe("copy");
  });
});

describe("shareUrl", () => {
  it("shares the short link, made absolute on this origin", () => {
    expect(shareUrl("/s/aB3dE7zQ9x", here)).toBe("https://band.example/s/aB3dE7zQ9x");
  });

  it("falls back to the page's own address when the short link is not there", () => {
    expect(shareUrl(undefined, here)).toBe("https://band.example/songs/coudy");
  });

  it("never carries the page's one-shot query flags", () => {
    // `pathname` has no query by definition; the fallback is built from it alone.
    expect(shareUrl(undefined, { ...here, pathname: "/takes/t1" })).toBe(
      "https://band.example/takes/t1",
    );
  });
});

describe("shortPathFrom", () => {
  it("takes a well-formed answer", () => {
    expect(shortPathFrom({ url: "/s/aB3dE7zQ9x" })).toBe("/s/aB3dE7zQ9x");
  });

  it("takes whatever the server's generator makes (the length is spelled out twice)", () => {
    const path = `/s/${generateShareCode()}`;
    expect(shortPathFrom({ url: path })).toBe(path);
  });

  it.each([
    ["an absolute URL", { url: "https://evil.example/s/aB3dE7zQ9x" }],
    ["a different path", { url: "/songs/coudy" }],
    ["a short code", { url: "/s/abc" }],
    ["no url", { error: "not_found" }],
    ["null", null],
    ["a string", "/s/aB3dE7zQ9x"],
  ])("refuses %s", (_label, body) => {
    expect(shortPathFrom(body)).toBeUndefined();
  });
});

describe("afterShareError", () => {
  it("ignores the person closing the share sheet", () => {
    expect(afterShareError(new DOMException("cancelled", "AbortError"))).toBe("ignore");
  });

  it("ignores a second tap while the share sheet is already open", () => {
    expect(afterShareError(new DOMException("already open", "InvalidStateError"))).toBe("ignore");
  });

  it("falls back to copying on any other failure", () => {
    expect(afterShareError(new DOMException("nope", "NotAllowedError"))).toBe("copy");
    expect(afterShareError(new Error("boom"))).toBe("copy");
    expect(afterShareError(undefined)).toBe("copy");
  });
});

describe("shareStateFrom", () => {
  it("reads the short path and both flags", () => {
    expect(shareStateFrom({ url: "/s/aB3dE7zQ9x", public: true, canBePublic: true })).toEqual({
      shortPath: "/s/aB3dE7zQ9x",
      isPublic: true,
      canBePublic: true,
    });
  });

  it("treats a missing or odd flag as false, never as public", () => {
    expect(shareStateFrom({ url: "/s/aB3dE7zQ9x" })).toEqual({
      shortPath: "/s/aB3dE7zQ9x",
      isPublic: false,
      canBePublic: false,
    });
    expect(shareStateFrom({ url: "/s/aB3dE7zQ9x", public: "true" })?.isPublic).toBe(false);
  });

  it("is nothing without a valid short path", () => {
    expect(
      shareStateFrom({ url: "https://evil.example/s/aB3dE7zQ9x", public: true }),
    ).toBeUndefined();
    expect(shareStateFrom(null)).toBeUndefined();
  });
});

describe("tapOpensSheet", () => {
  it("opens the switch only for a link that may be public", () => {
    expect(tapOpensSheet({ shortPath: "/s/x", isPublic: false, canBePublic: true })).toBe(true);
    expect(tapOpensSheet({ shortPath: "/s/x", isPublic: false, canBePublic: false })).toBe(false);
  });

  it("shares at once while the state is not known yet", () => {
    expect(tapOpensSheet(undefined)).toBe(false);
  });
});

import { generateShareCode } from "@bandplate/core";
import { describe, expect, it } from "vitest";
import { afterShareError, shareMechanism, shareUrl, shortPathFrom } from "./share-action.js";

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

  it("falls back to copying on any other failure", () => {
    expect(afterShareError(new DOMException("nope", "NotAllowedError"))).toBe("copy");
    expect(afterShareError(new Error("boom"))).toBe("copy");
    expect(afterShareError(undefined)).toBe("copy");
  });
});

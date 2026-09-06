// `isSameOrigin` is the app's own CSRF defense for every mutating page
// route (see the comment in csrf.ts, and astro.config.mjs for why it's
// now the ONLY such check — Astro's built-in `security.checkOrigin` is
// disabled because it resolves the wrong origin under the standalone Node
// adapter). It shipped with zero tests: `isSameOrigin -> return true`
// survived the entire suite, which means every one of these three cases
// needed a real assertion, not just "it exists".
import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./csrf.js";

function postRequest(originHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (originHeader !== undefined) {
    headers.origin = originHeader;
  }
  return new Request("https://bandlib.example/admin/members", {
    method: "POST",
    headers,
  });
}

describe("isSameOrigin", () => {
  it("is true when the Origin header matches the configured app origin exactly", () => {
    expect(isSameOrigin(postRequest("https://bandlib.example"), "https://bandlib.example")).toBe(
      true,
    );
  });

  it("is false when the Origin header names a different origin", () => {
    expect(isSameOrigin(postRequest("https://evil.example"), "https://bandlib.example")).toBe(
      false,
    );
  });

  it("is false when the Origin header is missing entirely", () => {
    expect(isSameOrigin(postRequest(undefined), "https://bandlib.example")).toBe(false);
  });

  it("is false for a same-host mismatch on scheme (http vs https)", () => {
    expect(isSameOrigin(postRequest("http://bandlib.example"), "https://bandlib.example")).toBe(
      false,
    );
  });

  it("is false for a same-host mismatch on port", () => {
    expect(
      isSameOrigin(postRequest("https://bandlib.example:8443"), "https://bandlib.example"),
    ).toBe(false);
  });
});

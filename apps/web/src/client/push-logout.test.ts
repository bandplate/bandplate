import { describe, expect, it } from "vitest";
import { endpointFieldValue } from "./push-logout.js";

describe("endpointFieldValue", () => {
  it("a live subscription -> its endpoint", () => {
    expect(endpointFieldValue({ endpoint: "https://push.example.com/a" })).toBe(
      "https://push.example.com/a",
    );
  });

  it("no subscription -> empty string, not the literal 'null'", () => {
    expect(endpointFieldValue(null)).toBe("");
  });
});

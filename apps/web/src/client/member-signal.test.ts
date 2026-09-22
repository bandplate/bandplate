import { describe, expect, it } from "vitest";
import { decodeMemberSignal, encodeMemberSignal } from "./member-signal.js";

describe("encodeMemberSignal / decodeMemberSignal", () => {
  it("round-trips a signed-in member", () => {
    expect(decodeMemberSignal(encodeMemberSignal("m-b"))).toBe("m-b");
  });

  it("round-trips nobody signed in", () => {
    expect(decodeMemberSignal(encodeMemberSignal(null))).toBeNull();
  });

  it("treats a missing value the same as nobody signed in", () => {
    // The `storage` event's `newValue` is `null` when the key was removed.
    expect(decodeMemberSignal(null)).toBeNull();
    expect(decodeMemberSignal(undefined)).toBeNull();
  });

  it("treats garbage the same as nobody signed in, rather than throwing", () => {
    // Another tab of an OLDER deploy, or a hand-edited devtools value.
    expect(decodeMemberSignal("not json")).toBeNull();
    expect(decodeMemberSignal("{}")).toBeNull();
    expect(decodeMemberSignal(JSON.stringify({ memberId: 42 }))).toBeNull();
    expect(decodeMemberSignal(JSON.stringify([]))).toBeNull();
  });
});

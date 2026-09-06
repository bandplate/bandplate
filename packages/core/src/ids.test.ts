import { describe, expect, it } from "vitest";
import { uuidv7 } from "./ids.js";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("produces a well-formed UUID string", () => {
    const id = uuidv7();
    expect(id).toMatch(UUID_SHAPE);
  });

  it("sets the version nibble to 7", () => {
    const id = uuidv7();
    expect(id[14]).toBe("7");
  });

  it("sets the variant bits to 10xx (nibble is 8, 9, a, or b)", () => {
    const id = uuidv7();
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      ids.add(uuidv7());
    }
    expect(ids.size).toBe(2000);
  });

  it("is monotonically sortable as a string, including many IDs generated within the same millisecond", () => {
    const ids: string[] = [];
    for (let i = 0; i < 5000; i++) {
      ids.push(uuidv7());
    }

    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it("keeps later real-time calls sorting after earlier ones", () => {
    const first = uuidv7();
    // Not a same-ms guarantee, but generation order should never invert.
    const second = uuidv7();
    expect(second >= first).toBe(true);
  });
});

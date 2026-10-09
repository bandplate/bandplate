import { describe, expect, it } from "vitest";
import {
  generateShareCode,
  isShareCode,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
} from "./share-code.js";

/** A byte source that replays a fixed sequence, cycling. */
function replay(bytes: number[]) {
  let i = 0;
  return (buffer: Uint8Array) => {
    for (let j = 0; j < buffer.length; j++) {
      buffer[j] = bytes[i % bytes.length] ?? 0;
      i++;
    }
  };
}

describe("generateShareCode", () => {
  it("is seven base62 characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateShareCode();
      expect(code).toHaveLength(SHARE_CODE_LENGTH);
      expect(code).toMatch(/^[0-9A-Za-z]{7}$/);
    }
  });

  it("maps each byte below 248 to the alphabet by its remainder", () => {
    expect(generateShareCode(replay([0, 1, 61, 62, 63, 247, 10]))).toBe(
      ["0", "1", "z", "0", "1", "z", "A"].join(""),
    );
  });

  it("throws away bytes at or above 248 instead of folding them in", () => {
    // 248..255 would be 0..7 under a plain `% 62`, which is the bias.
    const code = generateShareCode(replay([248, 255, 250, 5]));
    expect(code).toBe("5555555");
  });

  it("keeps drawing when a whole buffer is rejected", () => {
    let calls = 0;
    const code = generateShareCode((buffer) => {
      calls++;
      buffer.fill(calls === 1 ? 255 : 36);
    });
    expect(code).toBe("aaaaaaa");
    expect(calls).toBe(2);
  });

  it("uses every character of the alphabet over many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      for (const ch of generateShareCode()) {
        seen.add(ch);
      }
    }
    expect(seen.size).toBe(SHARE_CODE_ALPHABET.length);
  });
});

describe("isShareCode", () => {
  it("accepts a generated code", () => {
    expect(isShareCode(generateShareCode())).toBe(true);
  });

  it.each([
    ["too short", "abc123"],
    ["too long", "abc12345"],
    ["a dash", "abc-123"],
    ["a dot", "abc.123"],
    ["a slash", "abc/123"],
    ["empty", ""],
  ])("refuses %s", (_label, value) => {
    expect(isShareCode(value)).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(isShareCode(undefined)).toBe(false);
    expect(isShareCode(null)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeTitle, slugify } from "./text.js";

describe("normalizeTitle", () => {
  const cases: Array<[string, string]> = [
    // Case + whitespace
    ["Hello World", "hello world"],
    ["  multiple   spaces   here  ", "multiple spaces here"],
    ["\tTabs\tand\nnewlines\n", "tabs and newlines"],

    // Czech diacritics
    ["Přítel", "pritel"],
    ["Žár", "zar"],
    ["Ď", "d"],
    ["ď", "d"],
    ["Ť", "t"],
    ["ť", "t"],
    ["Ň", "n"],
    ["ň", "n"],
    ["Ř", "r"],
    ["ř", "r"],
    ["Ů", "u"],
    ["ů", "u"],
    ["Ě", "e"],
    ["ě", "e"],
    ["Čáry Máry Ďáblík", "cary mary dablik"],

    // Take/version suffixes
    ["Song Title (take 3)", "song title"],
    ["Song Title (Take 3)", "song title"],
    ["Song Title [take 12]", "song title"],
    ["Song Title - take 2", "song title"],
    ["Song Title -take 2", "song title"],
    ["Song Title(take 1)", "song title"],
    ["Song Title", "song title"],

    // Total on odd input
    ["", ""],
    ["   ", ""],
    ["!!!???", "!!!???"],
    ["áéíóú", "aeiou"],
    ["̈̈̈", ""],
  ];

  it.each(cases)("normalizeTitle(%j) === %j", (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeTitle("Přítel (take 3)");
    expect(normalizeTitle(once)).toBe(once);
  });
});

describe("slugify", () => {
  const cases: Array<[string, string]> = [
    // Case + spaces -> single hyphens
    ["Hello World", "hello-world"],
    ["  multiple   spaces   here  ", "multiple-spaces-here"],

    // Czech diacritics
    ["Přítel", "pritel"],
    ["Ř", "r"],
    ["Čáry Máry Ďáblík", "cary-mary-dablik"],

    // Punctuation collapsed to a single hyphen, not kept verbatim
    ["Song Title!!!", "song-title"],
    ["foo___bar", "foo-bar"],
    ["a  -  b", "a-b"],

    // Leading/trailing separators trimmed rather than left as edge hyphens
    ["-leading-and-trailing-", "leading-and-trailing"],

    // Alphanumeric mix survives
    ["Track 42", "track-42"],

    // Total on odd/empty input: falls back to "item" rather than "" or "-"
    ["", "item"],
    ["   ", "item"],
    ["!!!???", "item"],
  ];

  it.each(cases)("slugify(%j) === %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = slugify("Čáry Máry (take 3)!");
    expect(slugify(once)).toBe(once);
  });
});

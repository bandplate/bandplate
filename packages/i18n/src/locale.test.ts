import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatLongDate, formatShortDate } from "./format.js";
import { DEFAULT_LOCALE, isLocale, negotiateLocale } from "./locale.js";
import { countOf, formatNumber, plural } from "./plural.js";

describe("isLocale", () => {
  it("accepts the ones we speak and nothing else", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("cs")).toBe(true);
    expect(isLocale("sk")).toBe(false);
    expect(isLocale("cs-CZ")).toBe(false); // the id is the short key, not a BCP 47 tag
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(2)).toBe(false);
  });
});

describe("negotiateLocale", () => {
  it("no header at all is no opinion, which is English", () => {
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("")).toBe(DEFAULT_LOCALE);
  });

  it("matches on the primary subtag, so cs-CZ is Czech", () => {
    expect(negotiateLocale("cs-CZ,cs;q=0.9,en;q=0.8")).toBe("cs");
    expect(negotiateLocale("cs")).toBe("cs");
    expect(negotiateLocale("CS-cz")).toBe("cs");
  });

  it("honours quality order rather than header order", () => {
    expect(negotiateLocale("en;q=0.3,cs;q=0.9")).toBe("cs");
    expect(negotiateLocale("cs;q=0.2,en;q=0.7")).toBe("en");
  });

  it("skips languages we do not speak", () => {
    expect(negotiateLocale("de-DE,de;q=0.9,cs;q=0.5")).toBe("cs");
    expect(negotiateLocale("de,fr,es")).toBe(DEFAULT_LOCALE);
  });

  it("ignores an entry the sender explicitly refused", () => {
    expect(negotiateLocale("cs;q=0,en")).toBe("en");
  });

  it("a malformed header is not an error", () => {
    expect(negotiateLocale(",,;;")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("cs;q=banana,en")).toBe("en");
  });
});

describe("plural", () => {
  // The reason this package exists in the shape it does: English has two
  // forms, Czech has four, and the fourth (`other`) is also the genitive the
  // language needs after a numeral.
  const SONG = { one: "skladba", few: "skladby", many: "skladby", other: "skladeb" };

  it("English picks between exactly two", () => {
    const take = { one: "take", other: "takes" };
    expect(plural("en", 0, take)).toBe("takes");
    expect(plural("en", 1, take)).toBe("take");
    expect(plural("en", 2, take)).toBe("takes");
    expect(plural("en", 25, take)).toBe("takes");
  });

  it("Czech picks between four, including few for 2-4", () => {
    expect(plural("cs", 1, SONG)).toBe("skladba");
    expect(plural("cs", 2, SONG)).toBe("skladby");
    expect(plural("cs", 4, SONG)).toBe("skladby");
    expect(plural("cs", 5, SONG)).toBe("skladeb");
    expect(plural("cs", 0, SONG)).toBe("skladeb");
    expect(plural("cs", 11, SONG)).toBe("skladeb");
    expect(plural("cs", 1.5, SONG)).toBe("skladby"); // `many`
  });

  it("falls back to `other` for a form the catalog did not fill", () => {
    expect(plural("cs", 2, { other: "skladeb" })).toBe("skladeb");
  });
});

describe("countOf", () => {
  it("puts a localised number in front of the right form", () => {
    expect(countOf("en", 1, { one: "take", other: "takes" })).toBe("1 take");
    expect(countOf("en", 5, { one: "take", other: "takes" })).toBe("5 takes");
    expect(countOf("cs", 5, { one: "take", few: "taky", other: "takeů" })).toBe("5 takeů");
    expect(countOf("cs", 3, { one: "take", few: "taky", other: "takeů" })).toBe("3 taky");
  });
});

describe("formatNumber", () => {
  it("Czech groups with a space and decimalises with a comma", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    // A narrow no-break space, which is what CLDR specifies for cs grouping.
    expect(formatNumber("cs", 1234.5).replace(/\s/g, " ")).toBe("1 234,5");
  });
});

describe("dates", () => {
  // Fixed noon UTC so the host's timezone cannot flip the calendar day and
  // make this test fail somewhere other than where it was written. See
  // `format.ts` on the timezone bug this deliberately steps around.
  const JULY_8 = Date.UTC(2026, 6, 8, 12, 0, 0);

  it("renders the reader's language", () => {
    expect(formatLongDate("en", JULY_8)).toBe("July 8, 2026");
    expect(formatLongDate("cs", JULY_8)).toBe("8. července 2026");
    expect(formatShortDate("en", JULY_8)).toBe("Jul 8, 2026");
    expect(formatShortDate("cs", JULY_8).replace(/\s/g, " ")).toBe("8. 7. 2026");
  });

  it("an absent date is a dash, not a crash", () => {
    expect(formatLongDate("cs", null)).toBe("—");
    expect(formatShortDate("en", undefined)).toBe("—");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("is m:ss, and h:mm:ss past an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(63_000)).toBe("1:03");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });
});

describe("formatBytes", () => {
  it("uses SI units and localises the number", () => {
    expect(formatBytes("en", 512)).toBe("512 B");
    expect(formatBytes("en", 84_300_000)).toBe("84.3 MB");
    expect(formatBytes("cs", 84_300_000)).toBe("84,3 MB");
    // One decimal ALWAYS, so a column of sizes lines up. `Intl.NumberFormat`
    // would drop the trailing zero on its own; the originals used `.toFixed(1)`.
    expect(formatBytes("en", 6_000_000)).toBe("6.0 MB");
    expect(formatBytes("cs", 6_000_000)).toBe("6,0 MB");
    expect(formatBytes("en", 512_000)).toBe("512.0 KB");
  });

  // The installation's own language (`BANDPLATE_DEFAULT_LOCALE`) — what a
  // Czech deployment answers with when the header asks for nothing it has.
  it("falls back to the given locale rather than English when nothing matches", () => {
    expect(negotiateLocale("de-DE,de;q=0.9", "cs")).toBe("cs");
    expect(negotiateLocale(null, "cs")).toBe("cs");
    expect(negotiateLocale("", "cs")).toBe("cs");
  });

  // The fallback is a fallback. A browser that asks for a language this app
  // HAS is making a statement about the person reading, and outranks it.
  it("still honours a header that asks for a language the app has", () => {
    expect(negotiateLocale("en-GB,en;q=0.9", "cs")).toBe("en");
  });
});

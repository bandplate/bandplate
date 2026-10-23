import { describe, expect, it } from "vitest";
import { mayBePublic, type ShareTargetFacts, sharePath, sharePreview } from "./share-target.js";

// 8 July 2026, midday, so the date reads the same in any test machine's zone.
const JULY_8 = new Date(2026, 6, 8, 12, 0, 0).getTime();

const song: ShareTargetFacts = {
  kind: "song",
  song: { id: "s1", slug: "coudy", title: "Čoudy" },
  takeCount: 3,
};

const rehearsal = {
  id: "e1",
  kind: "rehearsal",
  title: null,
  venue: null,
  heldAt: JULY_8,
  archivedAt: null,
};

const namedConcert = {
  id: "e2",
  kind: "concert",
  title: "Dezerter",
  venue: "Klub 007",
  heldAt: JULY_8,
  archivedAt: null,
};

function take(overrides: Partial<Extract<ShareTargetFacts, { kind: "take" }>["take"]> = {}) {
  return {
    kind: "take" as const,
    take: {
      id: "t1",
      visibility: "band" as const,
      state: "published" as const,
      label: "take 2",
      recordedAt: JULY_8,
      ...overrides,
    },
    song: { title: "Čoudy" },
    event: rehearsal,
  };
}

describe("sharePath", () => {
  it("opens a song at its CURRENT slug", () => {
    expect(sharePath(song)).toBe("/songs/coudy");
  });

  it("opens an event and a band take by id", () => {
    expect(sharePath({ kind: "event", event: rehearsal, takeCount: 0 })).toBe("/events/e1");
    expect(sharePath(take())).toBe("/takes/t1");
  });

  it("never opens a private (stash) take", () => {
    expect(sharePath(take({ visibility: "private" }))).toBeUndefined();
  });

  it("never opens a personal day with no band take on it", () => {
    const personal = { ...rehearsal, kind: "personal" };
    expect(sharePath({ kind: "event", event: personal, takeCount: 0 })).toBeUndefined();
    expect(sharePath({ kind: "event", event: personal, takeCount: 1 })).toBe("/events/e1");
  });

  it("never opens an archived event (a merge archives the one it empties)", () => {
    const archived = { ...rehearsal, archivedAt: JULY_8 + 1 };
    expect(sharePath({ kind: "event", event: archived, takeCount: 3 })).toBeUndefined();
    expect(sharePreview({ kind: "event", event: archived, takeCount: 3 }, "cs")).toBeUndefined();
  });

  it("still opens a take whose event was archived: the take itself is live", () => {
    expect(sharePath({ ...take(), event: { ...rehearsal, archivedAt: JULY_8 } })).toBe("/takes/t1");
  });

  it("opens nothing for an unknown code (no facts)", () => {
    expect(sharePath(undefined)).toBeUndefined();
  });
});

describe("sharePreview", () => {
  it("says nothing at all for an unknown code or a private take", () => {
    expect(sharePreview(undefined, "cs")).toBeUndefined();
    expect(sharePreview(take({ visibility: "private" }), "cs")).toBeUndefined();
    expect(
      sharePreview(
        { kind: "event", event: { ...rehearsal, kind: "personal" }, takeCount: 0 },
        "en",
      ),
    ).toBeUndefined();
  });

  it("a song: its title and how many takes, with Czech plurals", () => {
    expect(sharePreview(song, "cs")).toEqual({ title: "Čoudy", description: "3 nahrávky" });
    expect(sharePreview({ ...song, takeCount: 5 }, "cs")?.description).toBe("5 nahrávek");
    expect(sharePreview({ ...song, takeCount: 1 }, "en")?.description).toBe("1 take");
  });

  it("an unnamed event: kind and date as the title, and as the line", () => {
    const preview = sharePreview({ kind: "event", event: rehearsal, takeCount: 2 }, "cs");
    expect(preview?.title).toMatch(/^Zkouška, 8\. července 2026$/);
    expect(preview?.description).toBe(preview?.title);
  });

  it("a named event: its own title (not the venue), then kind and date", () => {
    const preview = sharePreview({ kind: "event", event: namedConcert, takeCount: 2 }, "en");
    expect(preview?.title).toBe("Dezerter");
    expect(preview?.description).toMatch(/^Live, July 8, 2026$/);
  });

  it("a venue-only event falls back to kind and date, never the venue", () => {
    const venueOnly = { ...rehearsal, venue: "Zkušebna Žižkov" };
    const preview = sharePreview({ kind: "event", event: venueOnly, takeCount: 1 }, "cs");
    expect(preview?.title).toBe("Zkouška, 8. července 2026");
  });

  it("never puts the venue in any field, for any kind", () => {
    const venue = "Klub 007";
    // A full row, venue included, the way the loader hands it over.
    const unnamedAtVenue = { ...rehearsal, venue };
    const previews = [
      sharePreview({ kind: "event", event: namedConcert, takeCount: 2 }, "cs"),
      sharePreview({ kind: "event", event: unnamedAtVenue, takeCount: 2 }, "en"),
      sharePreview({ ...take(), event: namedConcert }, "cs"),
      sharePreview({ ...take(), event: unnamedAtVenue }, "en"),
    ];
    for (const preview of previews) {
      expect(preview).toBeDefined();
      expect(preview?.title).not.toContain(venue);
      expect(preview?.description).not.toContain(venue);
    }
  });

  it("a take at a named event: the event's own title in the line", () => {
    expect(sharePreview({ ...take(), event: namedConcert }, "en")?.description).toBe(
      "Take 2, Dezerter, July 8, 2026",
    );
  });

  it("a take: its song's title, then its label, the event and the date", () => {
    expect(sharePreview(take(), "cs")).toEqual({
      title: "Čoudy",
      description: "Take 2, zkouška, 8. července 2026",
    });
  });

  it("a take whose label only repeats the event's kind does not say it twice", () => {
    const preview = sharePreview(take({ label: "zkouška" }), "cs");
    expect(preview?.description).toBe("Zkouška, 8. července 2026");
  });

  it("a songless take is named by its date", () => {
    const preview = sharePreview({ ...take(), song: undefined }, "en");
    expect(preview?.title).toBe("Take from July 8, 2026");
  });

  it("carries no em-dash splice and no member names", () => {
    const all = [
      sharePreview(song, "cs"),
      sharePreview({ kind: "event", event: rehearsal, takeCount: 2 }, "cs"),
      sharePreview(take(), "cs"),
    ];
    for (const preview of all) {
      expect(preview?.description).not.toContain("—");
    }
  });
});

describe("mayBePublic", () => {
  it("allows a band take and an open event", () => {
    expect(mayBePublic(take())).toBe(true);
    expect(mayBePublic({ kind: "event", event: rehearsal, takeCount: 2 })).toBe(true);
  });

  it("never a song, though a song may be shared with the band", () => {
    expect(sharePath(song)).toBeDefined();
    expect(mayBePublic(song)).toBe(false);
  });

  it("never a draft take, though the band may still share one among itself", () => {
    for (const state of ["new", "uploading"] as const) {
      expect(sharePath(take({ state }))).toBe("/takes/t1");
      expect(mayBePublic(take({ state }))).toBe(false);
    }
    expect(mayBePublic(take({ state: "keeper" }))).toBe(true);
  });

  it("never anything sharePath refuses", () => {
    expect(mayBePublic(take({ visibility: "private" }))).toBe(false);
    expect(
      mayBePublic({ kind: "event", event: { ...rehearsal, archivedAt: JULY_8 }, takeCount: 2 }),
    ).toBe(false);
    expect(
      mayBePublic({ kind: "event", event: { ...rehearsal, kind: "personal" }, takeCount: 0 }),
    ).toBe(false);
    expect(mayBePublic(undefined)).toBe(false);
  });
});

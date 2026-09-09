import { type Db, songs, songsRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "../ids.js";
import { normalizeTitle } from "../text.js";
import { allocateSongSlug } from "./songs.js";

describe("allocateSongSlug", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  async function seed(title: string, slug: string) {
    return songsRepo.create(db, { title, slug, createdAt: 1000, updatedAt: 1000 });
  }

  it("returns the plain slug when nothing holds it", async () => {
    expect(await allocateSongSlug(db, "Neon Skyline")).toBe("neon-skyline");
  });

  it("walks past a taken slug", async () => {
    await seed("Neon Skyline", "neon-skyline");
    expect(await allocateSongSlug(db, "Neon Skyline")).toBe("neon-skyline-2");
  });

  it("keeps walking past a run of taken slugs", async () => {
    await seed("Neon Skyline", "neon-skyline");
    await seed("Neon Skyline II", "neon-skyline-2");
    await seed("Neon Skyline III", "neon-skyline-3");
    expect(await allocateSongSlug(db, "Neon Skyline")).toBe("neon-skyline-4");
  });

  it("normalizes diacritics the way the rest of the app does", async () => {
    expect(await allocateSongSlug(db, "Přítel o cestách")).toBe("pritel-o-cestach");
  });

  it("gives up at the 999 bound, returning a slug that may itself be taken", async () => {
    // Occupy `neon-skyline` and `neon-skyline-2` … `neon-skyline-998` — one
    // short of the bound — so the walk runs to its limit. Bulk-inserted
    // because 998 sequential `create` calls would dominate this suite's
    // budget. Each row needs a distinct title too: `songs.title_norm` is
    // UNIQUE, not just the slug.
    const rows = [
      { slug: "neon-skyline", title: "Neon Skyline" },
      ...Array.from({ length: 997 }, (_, i) => ({
        slug: `neon-skyline-${i + 2}`,
        title: `Neon Skyline ${i + 2}`,
      })),
    ].map((r) => ({
      id: uuidv7(),
      title: r.title,
      titleNorm: normalizeTitle(r.title),
      slug: r.slug,
      isStub: false,
      createdAt: 1000,
      updatedAt: 1000,
    }));
    await db.insert(songs).values(rows);

    // It stops and returns rather than looping — and note WHAT it returns:
    // `neon-skyline-999` is handed back without ever being checked for
    // freedom. The bound is a termination guarantee, not a uniqueness one,
    // which is exactly why every caller has to survive a UNIQUE violation on
    // `songs.slug` rather than trusting this.
    expect(await allocateSongSlug(db, "Neon Skyline")).toBe("neon-skyline-999");
  });
});

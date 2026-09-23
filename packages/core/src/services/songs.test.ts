import { type Db, songsRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateSongSlug } from "./songs.js";

// `getBySlug` is the one lookup the walk makes. It stays the real query for
// every test here but the bound one, which replaces it (see there). Mocked
// by the repo module's own path, not as `@bandplate/db`: that specifier
// resolved to a different module id for `songs.ts` than for this file, so a
// mock of it never reached the code under test. (A spy cannot do it either:
// `songsRepo` is an ESM namespace, its members read-only.)
vi.mock("../../../db/src/repos/songs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bandplate/db")["songsRepo"]>();
  return { ...actual, getBySlug: vi.fn(actual.getBySlug) };
});

describe("allocateSongSlug", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(() => {
    // Back to the real query (the `vi.fn` wrapper's own implementation).
    vi.mocked(songsRepo.getBySlug).mockReset();
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
    // Every slug reads as taken, so the walk runs to its limit. Stubbed
    // rather than seeded: the walk is ~1000 sequential lookups, and against
    // the real test database that took up to 5.6 s under a parallel
    // `pnpm test`, past vitest's timeout. What this test is about is the
    // bound, not the query, which the tests above already cover.
    const lookup = vi
      .mocked(songsRepo.getBySlug)
      .mockImplementation(
        async (_db, slug) => ({ slug }) as Awaited<ReturnType<typeof songsRepo.getBySlug>>,
      );

    // It stops and returns rather than looping — and note WHAT it returns:
    // `neon-skyline-999` is looked up, found taken (here every slug is), and
    // handed back anyway, because the bound is tested after the lookup. The
    // bound is a termination guarantee, not a uniqueness one, which is
    // exactly why every caller has to survive a UNIQUE violation on
    // `songs.slug` rather than trusting this.
    expect(await allocateSongSlug(db, "Neon Skyline")).toBe("neon-skyline-999");
    expect(lookup).toHaveBeenCalledTimes(999);
    expect(lookup).toHaveBeenLastCalledWith(db, "neon-skyline-999");
  });
});

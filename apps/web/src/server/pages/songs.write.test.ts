// The M8 write half of `server/pages/songs.ts`. The read half is covered by
// `songs.test.ts`; these are kept apart because they seed differently and the
// combined file would be the longest in the directory.
import type { Db } from "@bandplate/db";
import { songsRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countArchivedSongs,
  createSong,
  listSongsForLibrary,
  parseSongsListQuery,
  setSongArchived,
  updateSong,
} from "./songs.js";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

const FULL = {
  title: "Neon Skyline",
  musicalKey: "Am",
  tempoBpm: "96",
  chordProgression: "Am F C G",
  lyrics: "the whole first verse",
  notes: "starts on the and of four",
};

describe("createSong", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("creates a song with every field and a slug from the title", async () => {
    const result = await createSong(db, 1000, formData(FULL));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.song.title).toBe("Neon Skyline");
    expect(result.song.slug).toBe("neon-skyline");
    expect(result.song.musicalKey).toBe("Am");
    expect(result.song.tempoBpm).toBe(96);
    expect(result.song.lyrics).toBe("the whole first verse");
    expect(result.song.isStub).toBe(false);
  });

  it("stores an untouched optional field as NULL, not an empty string", async () => {
    // The form posts every input it renders, so this is what an "I only know
    // the title" add actually sends.
    const result = await createSong(
      db,
      1000,
      formData({ title: "Nightbus", musicalKey: "", tempoBpm: "", lyrics: "", notes: "" }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.song.musicalKey).toBeNull();
    expect(result.song.tempoBpm).toBeNull();
    expect(result.song.lyrics).toBeNull();
  });

  it("walks the slug past one already taken", async () => {
    await songsRepo.create(db, {
      title: "Neon Skyline (live)",
      slug: "neon-skyline",
      createdAt: 1000,
      updatedAt: 1000,
    });

    const result = await createSong(db, 2000, formData({ title: "Neon Skyline" }));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.song.slug).toBe("neon-skyline-2");
  });

  it("reports a duplicate rather than throwing on the UNIQUE index", async () => {
    await createSong(db, 1000, formData({ title: "Nightbus" }));

    // Different capitalisation and spacing — `normalizeTitle` folds both.
    const again = await createSong(db, 2000, formData({ title: "  NIGHTBUS " }));

    expect(again.kind).toBe("duplicate");
    if (again.kind !== "duplicate") return;
    expect(again.existing.title).toBe("Nightbus");
  });

  it("rejects an empty title against the title field", async () => {
    const result = await createSong(db, 1000, formData({ title: "   " }));
    expect(result).toEqual({ kind: "invalid", error: "Enter a title.", field: "title" });
  });

  it("rejects a nonsense tempo against the tempo field", async () => {
    const result = await createSong(db, 1000, formData({ title: "Nightbus", tempoBpm: "9000" }));
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.field).toBe("tempoBpm");
  });
});

describe("updateSong", () => {
  let db: Db;
  let id: string;

  beforeEach(async () => {
    db = await createTestDb();
    const created = await createSong(db, 1000, formData(FULL));
    if (created.kind !== "ok") throw new Error("seed failed");
    id = created.song.id;
  });

  it("saves the edited fields and bumps updatedAt", async () => {
    const result = await updateSong(
      db,
      2000,
      id,
      formData({ ...FULL, musicalKey: "Dm", notes: "" }),
    );

    expect(result.kind).toBe("ok");
    const after = await songsRepo.getById(db, id);
    expect(after?.musicalKey).toBe("Dm");
    expect(after?.notes).toBeNull();
    expect(after?.updatedAt).toBe(2000);
  });

  it("renames without moving the slug", async () => {
    await updateSong(db, 2000, id, formData({ ...FULL, title: "Neon Skyline (reprise)" }));

    const after = await songsRepo.getById(db, id);
    expect(after?.title).toBe("Neon Skyline (reprise)");
    // The URL is the slug. See `songsRepo.update`'s doc comment.
    expect(after?.slug).toBe("neon-skyline");
  });

  it("clears isStub — opening the sheet and saving IS the confirmation", async () => {
    const stub = await songsRepo.create(db, {
      title: "Untitled Jam 1",
      slug: "untitled-jam-1",
      isStub: true,
      createdAt: 1000,
      updatedAt: 1000,
    });

    await updateSong(db, 2000, stub.id, formData({ title: "The One In G" }));

    expect((await songsRepo.getById(db, stub.id))?.isStub).toBe(false);
  });

  it("reports a duplicate when renaming onto another song's title", async () => {
    await createSong(db, 1000, formData({ title: "Nightbus" }));

    const result = await updateSong(db, 2000, id, formData({ ...FULL, title: "nightbus" }));

    expect(result.kind).toBe("duplicate");
    if (result.kind !== "duplicate") return;
    expect(result.existing.title).toBe("Nightbus");
  });

  it("allows saving a song under its own unchanged title", async () => {
    const result = await updateSong(db, 2000, id, formData(FULL));
    expect(result.kind).toBe("ok");
  });

  it("reports not_found for an id that isn't there", async () => {
    const result = await updateSong(db, 2000, "nope", formData({ title: "Anything" }));
    expect(result).toEqual({ kind: "not_found" });
  });
});

describe("archiving", () => {
  let db: Db;
  let id: string;

  beforeEach(async () => {
    db = await createTestDb();
    const created = await createSong(db, 1000, formData({ title: "Old Set Closer" }));
    if (created.kind !== "ok") throw new Error("seed failed");
    id = created.song.id;
    const other = await createSong(db, 1000, formData({ title: "Nightbus" }));
    if (other.kind !== "ok") throw new Error("seed failed");
  });

  it("takes a song out of the library and puts it in the archived view", async () => {
    await setSongArchived(db, 3000, id, true);

    const library = await listSongsForLibrary(db, {});
    expect(library.map((s) => s.title)).toEqual(["Nightbus"]);

    // The Archived pill shows the archive INSTEAD of the library, not as well.
    const archived = await listSongsForLibrary(db, { archived: true });
    expect(archived.map((s) => s.title)).toEqual(["Old Set Closer"]);
    expect(await countArchivedSongs(db)).toBe(1);
  });

  it("puts it back", async () => {
    await setSongArchived(db, 3000, id, true);
    await setSongArchived(db, 4000, id, false);

    const library = await listSongsForLibrary(db, {});
    expect(library.map((s) => s.title).sort()).toEqual(["Nightbus", "Old Set Closer"]);
    expect(await countArchivedSongs(db)).toBe(0);
  });

  it("reports not_found rather than silently succeeding", async () => {
    expect(await setSongArchived(db, 3000, "nope", true)).toEqual({ kind: "not_found" });
  });
});

describe("parseSongsListQuery", () => {
  it("reads the archived flag only from an explicit 1", () => {
    expect(parseSongsListQuery(new URLSearchParams("archived=1")).archived).toBe(true);
    expect(parseSongsListQuery(new URLSearchParams("archived=0")).archived).toBeUndefined();
    expect(parseSongsListQuery(new URLSearchParams("")).archived).toBeUndefined();
  });

  it("keeps the search and sort it already parsed", () => {
    const q = parseSongsListQuery(new URLSearchParams("q=neon&sort=takes&archived=1"));
    expect(q).toEqual({ search: "neon", sort: "takes", archived: true });
  });
});

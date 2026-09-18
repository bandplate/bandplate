// The M8 write half of `server/pages/songs.ts`. The read half is covered by
// `songs.test.ts`; these are kept apart because they seed differently and the
// combined file would be the longest in the directory.
import type { Storage } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  favoritesRepo,
  membersRepo,
  notificationsRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countArchivedSongs,
  createSong,
  deleteSong,
  deleteSongConsequence,
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

/**
 * `song_chart_changes.member_id` references `members.id`, and (unlike most
 * FKs in this schema) this test database enforces it — so every
 * `createSong`/`updateSong` call below needs a real seeded member, not a
 * bare string.
 */
async function seedMember(db: Db, slug: string) {
  const member = await membersRepo.create(db, {
    displayName: slug,
    slug,
    email: `${slug}@example.com`,
    status: "active",
    createdAt: 1000,
  });
  return member.id;
}

describe("createSong", () => {
  let db: Db;
  let memberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    memberId = await seedMember(db, "robin");
  });

  it("creates a song with every field and a slug from the title", async () => {
    const result = await createSong(db, 1000, memberId, formData(FULL));

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
      memberId,
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

    const result = await createSong(db, 2000, memberId, formData({ title: "Neon Skyline" }));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.song.slug).toBe("neon-skyline-2");
  });

  it("reports a duplicate rather than throwing on the UNIQUE index", async () => {
    await createSong(db, 1000, memberId, formData({ title: "Nightbus" }));

    // Different capitalisation and spacing — `normalizeTitle` folds both.
    const again = await createSong(db, 2000, memberId, formData({ title: "  NIGHTBUS " }));

    expect(again.kind).toBe("duplicate");
    if (again.kind !== "duplicate") return;
    expect(again.existing.title).toBe("Nightbus");
  });

  it("rejects an empty title against the title field", async () => {
    const result = await createSong(db, 1000, memberId, formData({ title: "   " }));
    // A KEY, not a sentence: the schema is module level and cannot take a
    // locale, so the page resolves it at render. See `@bandplate/i18n`'s
    // `validationMessage`.
    expect(result).toEqual({ kind: "invalid", error: "titleRequired", field: "title" });
  });

  it("rejects a nonsense tempo against the tempo field", async () => {
    const result = await createSong(
      db,
      1000,
      memberId,
      formData({ title: "Nightbus", tempoBpm: "9000" }),
    );
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.field).toBe("tempoBpm");
  });
});

describe("updateSong", () => {
  let db: Db;
  let memberId: string;
  let id: string;

  beforeEach(async () => {
    db = await createTestDb();
    memberId = await seedMember(db, "robin");
    const created = await createSong(db, 1000, memberId, formData(FULL));
    if (created.kind !== "ok") throw new Error("seed failed");
    id = created.song.id;
  });

  it("saves the edited fields and bumps updatedAt", async () => {
    const result = await updateSong(
      db,
      2000,
      memberId,
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
    await updateSong(
      db,
      2000,
      memberId,
      id,
      formData({ ...FULL, title: "Neon Skyline (reprise)" }),
    );

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

    await updateSong(db, 2000, memberId, stub.id, formData({ title: "The One In G" }));

    expect((await songsRepo.getById(db, stub.id))?.isStub).toBe(false);
  });

  it("reports a duplicate when renaming onto another song's title", async () => {
    await createSong(db, 1000, memberId, formData({ title: "Nightbus" }));

    const result = await updateSong(
      db,
      2000,
      memberId,
      id,
      formData({ ...FULL, title: "nightbus" }),
    );

    expect(result.kind).toBe("duplicate");
    if (result.kind !== "duplicate") return;
    expect(result.existing.title).toBe("Nightbus");
  });

  it("allows saving a song under its own unchanged title", async () => {
    const result = await updateSong(db, 2000, memberId, id, formData(FULL));
    expect(result.kind).toBe("ok");
  });

  it("reports not_found for an id that isn't there", async () => {
    const result = await updateSong(db, 2000, memberId, "nope", formData({ title: "Anything" }));
    expect(result).toEqual({ kind: "not_found" });
  });
});

// Task 6 — who changed a song's chart, for the notification tick to read
// back later. `songsRepo.buildCreateStatement`/`buildUpdateStatement` batch
// the song write with `notificationsRepo.buildRecordChartChange`; these
// tests read that row back through `listSongChangesInWindow` rather than
// reaching into the schema directly.
describe("chart change recording", () => {
  let db: Db;
  let memberId: string;
  let otherMemberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    memberId = await seedMember(db, "robin");
    otherMemberId = await seedMember(db, "jules");
  });

  it("records `created` when a song is made", async () => {
    const result = await createSong(db, 1000, memberId, formData(FULL));
    if (result.kind !== "ok") throw new Error("seed failed");

    const changes = await notificationsRepo.listSongChangesInWindow(db, result.song.id, 0, 1000);
    expect(changes).toEqual([{ memberId, kind: "created" }]);
  });

  it("records `edited`, with the member, when the chords change", async () => {
    const created = await createSong(db, 1000, memberId, formData(FULL));
    if (created.kind !== "ok") throw new Error("seed failed");

    await updateSong(
      db,
      2000,
      otherMemberId,
      created.song.id,
      formData({ ...FULL, chordProgression: "Am F C G Em" }),
    );

    const changes = await notificationsRepo.listSongChangesInWindow(
      db,
      created.song.id,
      1000,
      2000,
    );
    expect(changes).toEqual([{ memberId: otherMemberId, kind: "edited" }]);
  });

  it("records nothing for a CRLF-only re-save", async () => {
    const created = await createSong(db, 1000, memberId, formData(FULL));
    if (created.kind !== "ok") throw new Error("seed failed");

    await updateSong(
      db,
      2000,
      otherMemberId,
      created.song.id,
      formData({ ...FULL, chordProgression: "Am F C G\r\n" }),
    );

    const changes = await notificationsRepo.listSongChangesInWindow(
      db,
      created.song.id,
      1000,
      2000,
    );
    expect(changes).toEqual([]);
  });

  it("records nothing for a title-only edit", async () => {
    const created = await createSong(db, 1000, memberId, formData(FULL));
    if (created.kind !== "ok") throw new Error("seed failed");

    await updateSong(
      db,
      2000,
      otherMemberId,
      created.song.id,
      formData({ ...FULL, title: "Neon Skyline (reprise)" }),
    );

    const changes = await notificationsRepo.listSongChangesInWindow(
      db,
      created.song.id,
      1000,
      2000,
    );
    expect(changes).toEqual([]);
  });

  it("records `created` for a stub promotion, even with the same chart text", async () => {
    const stub = await songsRepo.create(db, {
      title: "Untitled Jam 1",
      slug: "untitled-jam-1",
      chordProgression: "G C D",
      isStub: true,
      createdAt: 1000,
      updatedAt: 1000,
    });

    await updateSong(
      db,
      2000,
      memberId,
      stub.id,
      formData({ title: "The One In G", chordProgression: "G C D" }),
    );

    const changes = await notificationsRepo.listSongChangesInWindow(db, stub.id, 0, 2000);
    expect(changes).toEqual([{ memberId, kind: "created" }]);
  });
});

describe("archiving", () => {
  let db: Db;
  let memberId: string;
  let id: string;

  beforeEach(async () => {
    db = await createTestDb();
    memberId = await seedMember(db, "robin");
    const created = await createSong(db, 1000, memberId, formData({ title: "Old Set Closer" }));
    if (created.kind !== "ok") throw new Error("seed failed");
    id = created.song.id;
    const other = await createSong(db, 1000, memberId, formData({ title: "Nightbus" }));
    if (other.kind !== "ok") throw new Error("seed failed");
  });

  it("takes a song out of the library and puts it in the archived view", async () => {
    await setSongArchived(db, 3000, id, true);

    const { rows: library } = await listSongsForLibrary(db, {}, { limit: 25, offset: 0 });
    expect(library.map((s) => s.title)).toEqual(["Nightbus"]);

    // The Archived pill shows the archive INSTEAD of the library, not as well.
    const { rows: archived } = await listSongsForLibrary(
      db,
      { archived: true },
      { limit: 25, offset: 0 },
    );
    expect(archived.map((s) => s.title)).toEqual(["Old Set Closer"]);
    expect(await countArchivedSongs(db)).toBe(1);
  });

  it("puts it back", async () => {
    await setSongArchived(db, 3000, id, true);
    await setSongArchived(db, 4000, id, false);

    const { rows: library } = await listSongsForLibrary(db, {}, { limit: 25, offset: 0 });
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

describe("deleteSong", () => {
  let db: Db;
  let memberId: string;

  beforeEach(async () => {
    db = await createTestDb();
    memberId = await seedMember(db, "robin");
  });

  function recordingStorage() {
    const deleted: string[][] = [];
    const storage = {
      signedUploadUrl: async () => "u",
      signedDownloadUrl: async () => "d",
      head: async () => null,
      delete: async (keys: string[]) => {
        deleted.push(keys);
      },
      put: async () => {},
    } as unknown as Storage;
    return { storage, deleted };
  }

  async function seedSongWithTake() {
    const created = await createSong(db, 1000, memberId, formData({ title: "Neon Skyline" }));
    if (created.kind !== "ok") throw new Error("seed failed");
    const song = created.song;
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const take = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossy",
        format: "mp3",
        storageKey: `takes/${take.id}/master/lossy.mp3`,
        contentType: "audio/mpeg",
        bytes: 4_200_000,
        createdAt: 1000,
      },
    ]);
    await songsRepo.addAlias(db, song.id, "Neon Sky", "manual");
    return { song, take, event };
  }

  it("takes the song, its takes, their files and its aliases", async () => {
    const { song, take } = await seedSongWithTake();
    const { storage, deleted } = recordingStorage();

    const result = await deleteSong(db, storage, song.id);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.deletedTakes).toBe(1);
    expect(result.deletedAssets).toBe(1);
    expect(await songsRepo.getById(db, song.id)).toBeUndefined();
    expect(await takesRepo.getById(db, take.id)).toBeUndefined();
    expect(await assetsRepo.listByTake(db, take.id)).toEqual([]);
    expect(await songsRepo.listAliases(db, song.id)).toEqual([]);
    expect(deleted).toEqual([[`takes/${take.id}/master/lossy.mp3`]]);
  });

  it("leaves no vote or pin pointing at nothing", async () => {
    const { song, take } = await seedSongWithTake();
    const member = await membersRepo.create(db, {
      displayName: "Robin",
      slug: "robin-2",
      email: "robin2@example.com",
      status: "active",
      createdAt: 1000,
    });
    await votesRepo.castVote(db, {
      takeId: take.id,
      memberId: member.id,
      keeper: true,
      now: 1000,
    });
    await favoritesRepo.add(db, {
      memberId: member.id,
      targetType: "take",
      targetId: take.id,
      createdAt: 1000,
    });
    await favoritesRepo.add(db, {
      memberId: member.id,
      targetType: "song",
      targetId: song.id,
      createdAt: 1000,
    });
    const { storage } = recordingStorage();

    await deleteSong(db, storage, song.id);

    // Foreign keys are never enforced here (D1 parity), so nothing cleans
    // these up on our behalf.
    expect(await votesRepo.listByTake(db, take.id)).toEqual([]);
    expect((await favoritesRepo.listByMember(db, member.id)).rows).toEqual([]);
  });

  it("leaves the event alone — the session still happened", async () => {
    const { song, event } = await seedSongWithTake();
    const { storage } = recordingStorage();

    await deleteSong(db, storage, song.id);

    expect(await eventsRepo.getById(db, event.id)).toBeDefined();
  });

  it("still deletes when the bucket refuses", async () => {
    const { song } = await seedSongWithTake();
    const storage = {
      ...recordingStorage().storage,
      delete: async () => {
        throw new Error("bucket unreachable");
      },
    } as unknown as Storage;

    expect((await deleteSong(db, storage, song.id)).kind).toBe("ok");
    expect(await songsRepo.getById(db, song.id)).toBeUndefined();
  });

  it("reports not_found rather than silently succeeding", async () => {
    const { storage } = recordingStorage();
    expect(await deleteSong(db, storage, "nope")).toEqual({ kind: "not_found" });
  });
});

describe("deleteSongConsequence", () => {
  it("says plainly when nothing recorded is lost", () => {
    expect(deleteSongConsequence(0, 0, 0, "en")).toContain("no takes, so nothing recorded is lost");
  });

  it("leads with the recordings, and points at archiving instead", () => {
    const text = deleteSongConsequence(3, 14, 212_000_000, "en");
    expect(text).toContain("3 takes");
    expect(text).toContain("14 audio files");
    expect(text).toContain("Archive it instead");
  });
});

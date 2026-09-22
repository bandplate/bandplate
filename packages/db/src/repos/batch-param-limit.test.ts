// D1 rejects a statement with more than 100 bound parameters; local libSQL
// allows 32,766, so nothing else in this suite would ever notice. A list page
// holds up to 200 rows, and every batch lookup keyed by that page's ids splits
// its list with `chunk()`. These pin each chunk size against the BUILT query's
// real parameter count (`.toSQL()`), since a size is only safe relative to the
// other values the same statement binds. See docs/frontend-traps.md.
import { describe, expect, it } from "vitest";
import type { Read } from "../read.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as assetsRepo from "./assets.js";
import * as eventsRepo from "./events.js";
import * as favoritesRepo from "./favorites.js";
import * as instrumentsRepo from "./instruments.js";
import * as membersRepo from "./members.js";
import * as songsRepo from "./songs.js";
import * as takesRepo from "./takes.js";
import * as votesRepo from "./votes.js";

const D1_MAX_PARAMS = 100;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("a full chunk stays within D1's 100 bound parameters", async () => {
  const db = await createTestDb();

  const cases: [string, () => { toSQL(): { params: unknown[] } }][] = [
    [
      "takesRepo.getByIds",
      () => takesRepo.buildGetByIdsChunkQuery(db, ids(takesRepo.ID_CHUNK_SIZE)),
    ],
    [
      "takesRepo.listInstrumentsForTakes",
      () => takesRepo.buildListInstrumentsForTakesChunkQuery(db, ids(takesRepo.ID_CHUNK_SIZE)),
    ],
    [
      "takesRepo.listByEvents",
      () => takesRepo.buildListByEventsChunkQuery(db, ids(takesRepo.BAND_ID_CHUNK_SIZE)),
    ],
    [
      "takesRepo.countBySongs",
      () => takesRepo.buildCountBySongsChunkQuery(db, ids(takesRepo.BAND_ID_CHUNK_SIZE)),
    ],
    [
      "takesRepo.countByEvents",
      () => takesRepo.buildCountByEventsChunkQuery(db, ids(takesRepo.BAND_ID_CHUNK_SIZE)),
    ],
    [
      "assetsRepo.listPlayableMastersByTakeIds",
      () => assetsRepo.buildListPlayableMastersChunkQuery(db, ids(assetsRepo.PLAYABLE_CHUNK_SIZE)),
    ],
    [
      "votesRepo.listByMemberForTakes",
      () =>
        votesRepo.buildListByMemberForTakesChunkQuery(
          db,
          "member-1",
          ids(votesRepo.MEMBER_TAKES_CHUNK_SIZE),
        ),
    ],
    [
      "songsRepo.getByIds",
      () => songsRepo.buildGetByIdsChunkQuery(db, ids(songsRepo.GET_BY_IDS_CHUNK_SIZE)),
    ],
    [
      "eventsRepo.getByIds",
      () => eventsRepo.buildGetByIdsChunkQuery(db, ids(eventsRepo.GET_BY_IDS_CHUNK_SIZE)),
    ],
    [
      "membersRepo.getByIds",
      () => membersRepo.buildGetByIdsChunkQuery(db, ids(membersRepo.GET_BY_IDS_CHUNK_SIZE)),
    ],
    [
      "membersRepo.listInstrumentsForMembers",
      () =>
        membersRepo.buildListInstrumentsForMembersChunkQuery(
          db,
          ids(membersRepo.GET_BY_IDS_CHUNK_SIZE),
        ),
    ],
    [
      "instrumentsRepo.mergeInto (colliding charts)",
      () =>
        instrumentsRepo.buildDeleteCollidingChartsChunkQuery(
          db,
          "source-id",
          ids(instrumentsRepo.MERGE_CHART_CHUNK_SIZE),
        ),
    ],
    [
      "instrumentsRepo.mergeInto (colliding assets)",
      () =>
        instrumentsRepo.buildDeleteCollidingAssetsChunkQuery(
          db,
          ids(instrumentsRepo.MERGE_ASSET_CHUNK_SIZE),
        ),
    ],
    [
      "instrumentsRepo.mergeInto (duplicate members)",
      () =>
        instrumentsRepo.buildDeleteDuplicateMembersChunkQuery(
          db,
          "source-id",
          ids(instrumentsRepo.MERGE_MEMBER_CHUNK_SIZE),
        ),
    ],
    [
      "instrumentsRepo.mergeInto (duplicate takes)",
      () =>
        instrumentsRepo.buildDeleteDuplicateTakesChunkQuery(
          db,
          "source-id",
          ids(instrumentsRepo.MERGE_TAKE_CHUNK_SIZE),
        ),
    ],
  ];

  it.each(cases)("%s", (_name, build) => {
    expect(build().toSQL().params.length).toBeLessThanOrEqual(D1_MAX_PARAMS);
  });

  // And the loops really do cover every chunk, not just the first: an id past
  // the first chunk still comes back.
  it("a lookup longer than one chunk returns rows from every chunk", async () => {
    const song = await songsRepo.create(db, {
      title: "Last",
      slug: "last",
      createdAt: 1,
      updatedAt: 1,
    });
    const wanted = [...ids(250), song.id];
    expect((await songsRepo.getByIds(db, wanted)).map((s) => s.id)).toEqual([song.id]);
  });
});

// The planned forms (`build...Read`) that pages send as one batch: a lookup
// longer than one chunk becomes several statements in that batch, each within
// the cap, and a read that names its event by a subquery binds the subquery's
// values too.
describe("every statement of a planned read stays within D1's 100 bound parameters", async () => {
  const db = await createTestDb();
  const many = ids(250);
  const newest = takesRepo.buildNewestEventWithTakesPublishedSinceQuery(db, 0);
  const songBySlug = songsRepo.buildIdBySlugQuery(db, "a-song");
  const page = { limit: 200, offset: 0 };

  const cases: [string, Read<unknown>, number][] = [
    ["takesRepo.buildGetByIdsRead", takesRepo.buildGetByIdsRead(db, many), 3],
    [
      "takesRepo.buildListInstrumentsForTakesRead",
      takesRepo.buildListInstrumentsForTakesRead(db, many),
      3,
    ],
    ["takesRepo.buildCountBySongsRead", takesRepo.buildCountBySongsRead(db, many), 3],
    ["takesRepo.buildCountByEventsRead", takesRepo.buildCountByEventsRead(db, many), 3],
    [
      "assetsRepo.buildListPlayableMastersByTakeIdsRead",
      assetsRepo.buildListPlayableMastersByTakeIdsRead(db, many),
      3,
    ],
    [
      "votesRepo.buildListByMemberForTakesRead",
      votesRepo.buildListByMemberForTakesRead(db, "member-1", many),
      3,
    ],
    ["songsRepo.buildGetByIdsRead", songsRepo.buildGetByIdsRead(db, many), 3],
    ["eventsRepo.buildGetByIdsRead", eventsRepo.buildGetByIdsRead(db, many), 3],
    ["membersRepo.buildGetByIdsRead", membersRepo.buildGetByIdsRead(db, many), 3],
    ["eventsRepo.buildGetByIdRead (newest event)", eventsRepo.buildGetByIdRead(db, newest), 1],
    [
      "takesRepo.buildListPublishedSinceInEventRead (newest event)",
      takesRepo.buildListPublishedSinceInEventRead(db, newest, 0),
      1,
    ],
    [
      "takesRepo.buildCountPublishedSinceInEventRead (newest event)",
      takesRepo.buildCountPublishedSinceInEventRead(db, newest, 0),
      1,
    ],
    [
      "takesRepo.buildCountUnvotedPublishedSinceInEventRead (newest event)",
      takesRepo.buildCountUnvotedPublishedSinceInEventRead(db, "member-1", newest, 0),
      1,
    ],
    [
      "votesRepo.buildTakesOfMemberPageRead",
      votesRepo.buildTakesOfMemberPageRead(db, "member-1", { page: { limit: 200, offset: 0 } }),
      1,
    ],
    // The song and event pages' first batch: keyed by the slug's query or the
    // event id, never by a list, so one statement each (two for a page and
    // its count) whatever the page size.
    ["songsRepo.buildGetBySlugRead", songsRepo.buildGetBySlugRead(db, "a-song"), 1],
    ["songsRepo.buildListAliasesRead (slug)", songsRepo.buildListAliasesRead(db, songBySlug), 1],
    [
      "songsRepo.buildListInstrumentNotesRead (slug)",
      songsRepo.buildListInstrumentNotesRead(db, songBySlug),
      1,
    ],
    [
      "takesRepo.buildListBySongRead (slug)",
      takesRepo.buildListBySongRead(db, songBySlug, { page }),
      2,
    ],
    [
      "takesRepo.buildListStashRead (slug)",
      takesRepo.buildListStashRead(db, "member-1", { songId: songBySlug }),
      1,
    ],
    [
      "favoritesRepo.buildIsFavoritedRead (slug)",
      favoritesRepo.buildIsFavoritedRead(db, "member-1", "song", songBySlug),
      1,
    ],
    ["assetsRepo.buildTallyBySongRead (slug)", assetsRepo.buildTallyBySongRead(db, songBySlug), 1],
    [
      "takesRepo.buildListByEventRead",
      takesRepo.buildListByEventRead(db, "event-1", { order: "asc", page }),
      2,
    ],
    ["eventsRepo.buildListRecentRead", eventsRepo.buildListRecentRead(db, { limit: 100 }), 1],
    ["eventsRepo.buildListOnDayRead", eventsRepo.buildListOnDayRead(db, "rehearsal", 0), 1],
  ];

  it.each(cases)("%s", (_name, read, statements) => {
    expect(read.statements).toHaveLength(statements);
    for (const statement of read.statements) {
      const built = (statement as unknown as { toSQL(): { params: unknown[] } }).toSQL();
      expect(built.params.length).toBeLessThanOrEqual(D1_MAX_PARAMS);
    }
  });
});

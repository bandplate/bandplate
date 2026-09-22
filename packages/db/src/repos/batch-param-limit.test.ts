// D1 rejects a statement with more than 100 bound parameters; local libSQL
// allows 32,766, so nothing else in this suite would ever notice. A list page
// holds up to 200 rows, and every batch lookup keyed by that page's ids splits
// its list with `chunk()`. These pin each chunk size against the BUILT query's
// real parameter count (`.toSQL()`), since a size is only safe relative to the
// other values the same statement binds. See docs/frontend-traps.md.
import { describe, expect, it } from "vitest";
import { createTestDb } from "../testing/create-test-db.js";
import * as assetsRepo from "./assets.js";
import * as eventsRepo from "./events.js";
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

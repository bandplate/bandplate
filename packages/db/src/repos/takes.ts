import { normalizeTitle, uuidv7 } from "@bandplate/core";
import { type SQL, and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  assets,
  instruments,
  songAliases,
  songs,
  takeInstruments,
  takes,
  votes,
} from "../schema/sqlite/index.js";
import type { Instrument } from "./instruments.js";
import { escapeLikePattern } from "./like-pattern.js";

export type Take = typeof takes.$inferSelect;
export type TakeState = Take["state"];

export interface CreateTakeInput {
  songId: string;
  eventId: string;
  label?: string | null;
  recordedAt: number;
  durationMs?: number | null;
  state?: TakeState;
  clientRef?: string | null;
  notes?: string | null;
  createdAt: number;
  updatedAt: number;
  /** Instruments present on this take (populates take_instruments). */
  instrumentIds?: string[];
}

/**
 * Inserts a take and its take_instruments rows atomically. The id is
 * client-generated (uuidv7), so there is no need to read the row back after
 * writing it — that read-then-write pattern is exactly what the D1 batch
 * constraint forbids: two round trips with no atomicity between them would
 * let a partial failure leave a take with zero take_instruments rows, which
 * then silently vanishes from listByInstruments. Instead, when there are
 * instruments to attach, both inserts go into a single `db.batch([...])` so
 * they succeed or fail together; the row returned to the caller is the one
 * constructed locally, matching the column defaults declared in the schema.
 */
export async function create(db: Db, input: CreateTakeInput): Promise<Take> {
  const id = uuidv7();
  const row: Take = {
    id,
    songId: input.songId,
    eventId: input.eventId,
    label: input.label ?? null,
    recordedAt: input.recordedAt,
    durationMs: input.durationMs ?? null,
    state: input.state ?? "uploading",
    keeperVotes: 0,
    totalVotes: 0,
    ratingScore: 0,
    clientRef: input.clientRef ?? null,
    notes: input.notes ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    publishedAt: null,
    purgedAt: null,
  };

  const insertTake = db.insert(takes).values(row);
  const instrumentIds = input.instrumentIds ?? [];

  if (instrumentIds.length > 0) {
    await db.batch([
      insertTake,
      db
        .insert(takeInstruments)
        .values(instrumentIds.map((instrumentId) => ({ takeId: id, instrumentId }))),
    ]);
  } else {
    await insertTake;
  }

  return row;
}

export async function getById(db: Db, id: string): Promise<Take | undefined> {
  const [row] = await db.select().from(takes).where(eq(takes.id, id)).limit(1);
  return row;
}

/**
 * Ingest idempotency lookup — mirrors `eventsRepo.getByClientRef`. Stable
 * per take within a project (contract v1 §3): the bridge prefers the
 * Reaper region GUID.
 */
export async function getByClientRef(db: Db, clientRef: string): Promise<Take | undefined> {
  const [row] = await db.select().from(takes).where(eq(takes.clientRef, clientRef)).limit(1);
  return row;
}

/**
 * Publish (or re-file as `new`) a take in one statement, setting
 * `publishedAt` alongside `state` — `setState` above deliberately doesn't
 * touch `publishedAt` since none of its other callers need to.
 */
export async function setStateWithPublishedAt(
  db: Db,
  id: string,
  state: TakeState,
  publishedAt: number | null,
  updatedAt: number,
): Promise<void> {
  await db.update(takes).set({ state, publishedAt, updatedAt }).where(eq(takes.id, id));
}

/**
 * Deletes a take and its dependent rows (`assets`, `take_instruments`).
 * Explicit deletes rather than relying on the schema's `ON DELETE CASCADE`
 * FK actions: this codebase never issues `PRAGMA foreign_keys = ON` (kept
 * off so it behaves identically to D1, which does not enforce FKs either),
 * so SQLite would silently leave orphaned `assets`/`take_instruments` rows
 * behind if this relied on cascade. Precomputed into a single
 * `db.batch([...])` — see the repo-wide rule against interactive
 * transactions/read-then-write races on D1.
 */
export async function remove(db: Db, id: string): Promise<void> {
  await db.batch([
    db.delete(assets).where(eq(assets.takeId, id)),
    db.delete(takeInstruments).where(eq(takeInstruments.takeId, id)),
    db.delete(takes).where(eq(takes.id, id)),
  ]);
}

/** Batch lookup — avoids one round trip per row when rendering a mixed list (favorites, votes). */
export async function getByIds(db: Db, ids: string[]): Promise<Take[]> {
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(takes).where(inArray(takes.id, ids));
}

/**
 * Safety cap for `listBySong`/`listUnvotedByMember`'s default (unrequested)
 * limit — review round 1's F6. Neither listing has a UI for paging past it
 * today (a song's own take count, and one member's unvoted queue, are both
 * naturally small in practice), so this is a defensive ceiling rather than
 * a real pagination feature the way `search`'s `SEARCH_LIMIT` is — but the
 * review is right that "no LIMIT at all" is still wrong even for a listing
 * that's SUPPOSED to stay small.
 */
const DEFAULT_TAKE_LIST_CAP = 500;

export async function listBySong(db: Db, songId: string): Promise<Take[]> {
  return (
    db
      .select()
      .from(takes)
      .where(eq(takes.songId, songId))
      // `recordedAt` alone is not unique — two takes recorded at the same
      // instant (or, in a test fixture, given the same literal timestamp)
      // would otherwise have non-contractual relative order. `id` (uuidv7,
      // itself roughly time-ordered) is a real, deterministic tie-break.
      .orderBy(desc(takes.recordedAt), desc(takes.id))
      .limit(DEFAULT_TAKE_LIST_CAP)
  );
}

export interface ListByEventOptions {
  /**
   * `"desc"` (default, newest first) matches every other take listing.
   * `"asc"` gives the order takes were actually recorded during that one
   * session — what the event detail page shows, since "first take of the
   * day first" is how a member reconstructs what happened that day.
   */
  order?: "asc" | "desc";
}

export async function listByEvent(
  db: Db,
  eventId: string,
  options: ListByEventOptions = {},
): Promise<Take[]> {
  const direction = options.order === "asc" ? asc(takes.recordedAt) : desc(takes.recordedAt);
  return db.select().from(takes).where(eq(takes.eventId, eventId)).orderBy(direction);
}

/**
 * Batch version of `listByEvent` for the home page's "recent events, each
 * with their takes" section — one query for every event in the list rather
 * than one `listByEvent` round trip per event. Callers must dedupe
 * `eventIds` themselves, matching `listInstrumentsForTakes`/`listByInstruments`.
 * Grouped in JS (a single `ORDER BY` can't express "ordered per group"
 * cleanly in SQLite without a window function), but the actual data
 * transfer is still the one query this function issues.
 */
export async function listByEvents(
  db: Db,
  eventIds: string[],
  options: ListByEventOptions = {},
): Promise<Map<string, Take[]>> {
  const result = new Map<string, Take[]>();
  if (eventIds.length === 0) {
    return result;
  }

  const direction = options.order === "asc" ? asc(takes.recordedAt) : desc(takes.recordedAt);
  const rows = await db
    .select()
    .from(takes)
    .where(inArray(takes.eventId, eventIds))
    .orderBy(direction);

  for (const row of rows) {
    const existing = result.get(row.eventId);
    if (existing) {
      existing.push(row);
    } else {
      result.set(row.eventId, [row]);
    }
  }
  return result;
}

/**
 * Takes that have ALL of the given instruments (AND semantics, not any-of).
 * A take with {bass, drums} matches a query for {bass} and for
 * {bass, drums}, but a take with only {bass} does not match {bass, drums}.
 */
export async function listByInstruments(db: Db, instrumentIds: string[]): Promise<Take[]> {
  if (instrumentIds.length === 0) {
    return [];
  }

  const matches = await db
    .select({ takeId: takeInstruments.takeId })
    .from(takeInstruments)
    .where(inArray(takeInstruments.instrumentId, instrumentIds))
    .groupBy(takeInstruments.takeId)
    .having(sql`count(distinct ${takeInstruments.instrumentId}) = ${instrumentIds.length}`);

  const ids = matches.map((m) => m.takeId);
  if (ids.length === 0) {
    return [];
  }

  return db.select().from(takes).where(inArray(takes.id, ids)).orderBy(desc(takes.recordedAt));
}

export async function setState(
  db: Db,
  id: string,
  state: TakeState,
  updatedAt: number,
): Promise<void> {
  await db.update(takes).set({ state, updatedAt }).where(eq(takes.id, id));
}

/**
 * Batch-fetches the instruments on each of the given takes in one query
 * (rather than one round trip per take row in a list), ordered by the
 * instrument's own sort order. Callers must dedupe `takeIds` themselves —
 * this does not, matching `listByInstruments`.
 */
export async function listInstrumentsForTakes(
  db: Db,
  takeIds: string[],
): Promise<Map<string, Instrument[]>> {
  const result = new Map<string, Instrument[]>();
  if (takeIds.length === 0) {
    return result;
  }

  const rows = await db
    .select({ takeId: takeInstruments.takeId, instrument: instruments })
    .from(takeInstruments)
    .innerJoin(instruments, eq(instruments.id, takeInstruments.instrumentId))
    .where(inArray(takeInstruments.takeId, takeIds))
    .orderBy(instruments.sortOrder);

  for (const row of rows) {
    const existing = result.get(row.takeId);
    if (existing) {
      existing.push(row.instrument);
    } else {
      result.set(row.takeId, [row.instrument]);
    }
  }
  return result;
}

/**
 * The home page's "needs your vote" section: published takes this member
 * has not cast a vote on yet, newest first (the same default ordering as
 * every other take listing). `NOT IN (SELECT take_id FROM votes WHERE
 * member_id = ...)` rather than a post-fetch JS filter — the votes table
 * can grow without bound, so filtering it out in SQL is the only version of
 * this that stays cheap as the archive grows.
 */
export interface ListUnvotedByMemberOptions {
  limit?: number;
}

export async function listUnvotedByMember(
  db: Db,
  memberId: string,
  options: ListUnvotedByMemberOptions = {},
): Promise<Take[]> {
  const votedTakeIds = db
    .select({ takeId: votes.takeId })
    .from(votes)
    .where(eq(votes.memberId, memberId));

  return (
    db
      .select()
      .from(takes)
      .where(and(eq(takes.state, "published"), notInArray(takes.id, votedTakeIds)))
      // See `listBySong`'s comment on `desc(takes.id)` as a deterministic
      // tie-break for takes sharing a `recordedAt`.
      .orderBy(desc(takes.recordedAt), desc(takes.id))
      .limit(options.limit ?? DEFAULT_TAKE_LIST_CAP)
  );
}

/**
 * `/search`'s backing query: every filter is optional and they all combine
 * with AND (an empty `SearchFilters` returns every take, newest first — the
 * same default the search page relies on for an unfiltered visit).
 *
 * The instrument filter reuses `listByInstruments`' AND-semantics subquery
 * rather than re-deriving it — same reasoning `songsRepo.listWithStats`
 * already uses for its own instrument filter (delegate to the one place
 * that logic is tested). The free-text filter matches a song's title OR any
 * of its aliases (manual or ingest-created), normalized/escaped the same
 * way `songsRepo.listWithStats` does its own title search.
 */
export interface SearchFilters {
  /** AND semantics — a take must carry every one of these. Caller must dedupe. */
  instrumentIds?: string[];
  /** `recordedAt >=` this (inclusive), epoch ms. */
  dateFrom?: number;
  /** `recordedAt <=` this (inclusive), epoch ms. */
  dateTo?: number;
  /** `ratingScore >=` this (0..1). */
  minRating?: number;
  /** Restrict to these states — empty/omitted means every state. */
  states?: TakeState[];
  /** Case/diacritic-insensitive substring match against song title or alias. */
  search?: string;
}

/**
 * `"recent"` (default) — newest first, same as every other take listing.
 * `"rating"` — `keeperVotes DESC, ratingScore DESC` (Task 8 brief, §1): a
 * take with 6 keeper votes out of 7 outranks one with 1 keeper vote out of
 * 1, even though the second has a higher `ratingScore` (1.0 vs ~0.86) — vote
 * COUNT is the primary key precisely so a single enthusiastic vote can't
 * outrank a take the whole band has actually weighed in on. `ratingScore`
 * only breaks a tie between takes with the same `keeperVotes`.
 */
export type TakeSort = "recent" | "rating";

export interface SearchOptions {
  /** Override for tests — production callers should leave this at `SEARCH_LIMIT`. */
  limit?: number;
  /** Defaults to `"recent"`. */
  sort?: TakeSort;
}

/**
 * Hard cap on `search`'s result set (review round 1's F6): an unfiltered
 * `/search` used to have no LIMIT at all, returning literally every take in
 * the archive. Unlike `listBySong`/`listUnvotedByMember` (naturally small,
 * per-song/per-member listings — see `DEFAULT_TAKE_LIST_CAP`), an
 * unfiltered archive-wide search is exactly the case that keeps growing, so
 * this one surfaces a real `truncated` flag rather than just capping
 * silently.
 */
export const SEARCH_LIMIT = 200;

export interface SearchResult {
  results: Take[];
  /** True when more takes match than were returned — narrow the filters (or
   *  free-text search) to see the rest. */
  truncated: boolean;
}

export async function search(
  db: Db,
  filters: SearchFilters = {},
  options: SearchOptions = {},
): Promise<SearchResult> {
  const limit = options.limit ?? SEARCH_LIMIT;
  const conditions: SQL[] = [];

  if (filters.instrumentIds && filters.instrumentIds.length > 0) {
    const matching = await listByInstruments(db, filters.instrumentIds);
    const ids = matching.map((t) => t.id);
    if (ids.length === 0) {
      return { results: [], truncated: false };
    }
    conditions.push(inArray(takes.id, ids));
  }

  if (filters.search) {
    const pattern = `%${escapeLikePattern(normalizeTitle(filters.search))}%`;
    const bySongTitle = await db
      .select({ id: songs.id })
      .from(songs)
      .where(sql`${songs.titleNorm} LIKE ${pattern} ESCAPE '\\'`);
    const byAlias = await db
      .select({ songId: songAliases.songId })
      .from(songAliases)
      .where(sql`${songAliases.aliasNorm} LIKE ${pattern} ESCAPE '\\'`);
    const songIds = [
      ...new Set([...bySongTitle.map((r) => r.id), ...byAlias.map((r) => r.songId)]),
    ];
    if (songIds.length === 0) {
      return { results: [], truncated: false };
    }
    conditions.push(inArray(takes.songId, songIds));
  }

  if (filters.dateFrom !== undefined) {
    conditions.push(gte(takes.recordedAt, filters.dateFrom));
  }
  if (filters.dateTo !== undefined) {
    conditions.push(lte(takes.recordedAt, filters.dateTo));
  }
  if (filters.minRating !== undefined) {
    conditions.push(gte(takes.ratingScore, filters.minRating));
  }
  if (filters.states && filters.states.length > 0) {
    conditions.push(inArray(takes.state, filters.states));
  }

  // Fetch one row past the limit — if it comes back, there are more matches
  // than `limit` and the caller should say so, rather than the member
  // silently seeing a partial archive with no indication it's partial.
  const query =
    conditions.length > 0
      ? db
          .select()
          .from(takes)
          .where(and(...conditions))
      : db.select().from(takes);
  // `desc(takes.id)` is the same deterministic tie-break `listBySong` uses —
  // see its comment. It's the LAST key in both orderings (after whatever
  // the sort mode itself ranks by), so it only ever breaks a tie the sort
  // mode left open, never overrides it.
  const orderBy =
    options.sort === "rating"
      ? [desc(takes.keeperVotes), desc(takes.ratingScore), desc(takes.recordedAt), desc(takes.id)]
      : [desc(takes.recordedAt), desc(takes.id)];
  const rows = await query.orderBy(...orderBy).limit(limit + 1);

  const truncated = rows.length > limit;
  return { results: truncated ? rows.slice(0, limit) : rows, truncated };
}

import { normalizeTitle, uuidv7 } from "@bandplate/core";
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "../client.js";
import {
  assets,
  favorites,
  instruments,
  members,
  songAliases,
  songs,
  takeInstruments,
  takes,
  votes,
} from "../schema/sqlite/index.js";
import { chunk } from "./chunk.js";
import type { Instrument } from "./instruments.js";
import { escapeLikePattern } from "./like-pattern.js";
import { DEFAULT_PAGE_SIZE, type PageArgs, type Paged } from "./pagination.js";

export type Take = typeof takes.$inferSelect;
export type TakeState = Take["state"];
export type TakeVisibility = Take["visibility"];

type VisibilityFacts = { visibility: TakeVisibility; ownerMemberId: string | null };

/**
 * Whether `memberId` may see this take at all — the one authorization rule for
 * the stash. A band take is everyone's; a private take is its owner's alone,
 * and a caller that is not a member (a service token, nobody) sees no private
 * take. Every route and loader that resolves a take BY ID asks this; listings
 * never need to, because `bandVisibleCondition` keeps private rows out of
 * their SQL.
 */
export function isVisibleTo(take: VisibilityFacts, memberId: string | undefined): boolean {
  if (take.visibility === "band") {
    return true;
  }
  return memberId !== undefined && take.ownerMemberId === memberId;
}

/**
 * Whether the band votes on this take. A personal recording (one with an owner)
 * is published for listening, not for judging: no vote control, never in "not
 * voted by me", never in the weekly reminder.
 */
export function isVotable(take: VisibilityFacts): boolean {
  return take.visibility === "band" && take.ownerMemberId === null;
}

/**
 * The floor under every band view: a private take never appears in a listing,
 * a count or a search — not even for its owner, who sees it in the stash views
 * instead (`listStash`). Exported so `songsRepo` composes the same condition.
 */
export function bandVisibleCondition(): SQL {
  return eq(takes.visibility, "band");
}

/**
 * The distinct song ids of these takes, songless ones dropped.
 *
 * Every loader that renders a list of takes needs this to hydrate the titles,
 * and since 0011 a stash take may have no song. Written once here rather than
 * as a `.filter(...)` repeated in six loaders, so "why can this be null" has
 * one place to be answered.
 */
export function songIdsOf(rows: Pick<Take, "songId">[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.songId === null ? [] : [row.songId])))];
}

/**
 * What the band votes on: no owner. `owner_member_id IS NULL` already implies
 * `band` (a private take always has an owner), and — unlike `eq` — it binds no
 * parameter, which matters inside `buildCountUnvotedByMembersChunkQuery`'s
 * D1 parameter budget.
 */
function votableCondition(): SQL {
  return isNull(takes.ownerMemberId);
}

interface CreateTakeCommon {
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
  /** Only the stash sets this; NULL is a band take. */
  ownerMemberId?: string | null;
}

/**
 * A take to insert, in the two shapes the invariant allows.
 *
 * THE INVARIANT: a band-visible take always has a song. A recording may reach
 * the stash before its member has decided what song it is, and the song is
 * chosen when it is added to the band — so `songId` is optional exactly when
 * `visibility` is `private`, and required otherwise. Split into a union rather
 * than left loose with a runtime check, because the compiler can say this at
 * the call site of every one of the band-side writers (ingest, the upload
 * panel, the seed) for free.
 */
export type CreateTakeInput =
  | (CreateTakeCommon & {
      /** Defaults to `band`. */
      visibility?: "band";
      songId: string;
    })
  | (CreateTakeCommon & {
      visibility: "private";
      /** NULL is a recording whose song is not decided yet. */
      songId?: string | null;
    });

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
  const visibility = input.visibility ?? "band";
  // The union above says this at compile time; this says it to a caller that
  // built the object dynamically, or cast. A band take with no song would be
  // invisible to nothing — it would sit in every listing with a blank title.
  if (input.songId == null && visibility !== "private") {
    throw new Error("a band-visible take needs a song");
  }
  const id = uuidv7();
  const row: Take = {
    id,
    songId: input.songId ?? null,
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
    pushBatchedAt: null,
    ownerMemberId: input.ownerMemberId ?? null,
    visibility,
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

export interface UpdateTakeInput {
  label?: string | null;
  notes?: string | null;
  recordedAt?: number;
  /**
   * Moving a take to a different song. "The bridge filed this under the wrong
   * song" is the likeliest correction after a run, and it is a one-column fix.
   *
   * There is deliberately no `eventId`: a take belongs to the session it was
   * recorded in, so getting that wrong is a bridge bug rather than a member's
   * typo. Moving takes between events happens only in the event-adoption
   * repair path, which has its own function.
   */
  songId?: string;
  /**
   * The take's duration in milliseconds. Nothing wrote this before manual
   * uploads existed — ingest declares it and the seed fakes it — so this is
   * the only setter, rather than a bespoke `setDuration`.
   */
  durationMs?: number | null;
  updatedAt: number;
}

/**
 * Update a take's metadata and, optionally, replace its instrument set.
 *
 * The instrument half is replace-all and must be atomic with the update, so
 * it goes through `db.batch([...])` — a delete followed by an insert as two
 * separate awaits could leave a take with zero `take_instruments` rows if the
 * second failed, and a take with no instruments silently vanishes from
 * `listByInstruments`. Same shape (and same reasoning) as
 * `membersRepo.setInstruments`.
 *
 * Passing `undefined` leaves the instrument set alone; passing `[]` clears it.
 * The distinction matters because the edit form and the metadata-only callers
 * are different paths.
 */
export async function update(
  db: Db,
  id: string,
  input: UpdateTakeInput,
  instrumentIds?: string[],
): Promise<void> {
  const updateTake = db.update(takes).set(input).where(eq(takes.id, id));

  if (instrumentIds === undefined) {
    await updateTake;
    return;
  }

  const deleteExisting = db.delete(takeInstruments).where(eq(takeInstruments.takeId, id));
  const unique = [...new Set(instrumentIds)];

  if (unique.length === 0) {
    await db.batch([updateTake, deleteExisting]);
    return;
  }

  await db.batch([
    updateTake,
    deleteExisting,
    db.insert(takeInstruments).values(unique.map((instrumentId) => ({ takeId: id, instrumentId }))),
  ]);
}

/**
 * Add one instrument to a take without disturbing the rest of the set.
 *
 * Uploading a stem calls this: a bass stem existing is PROOF bass was played,
 * so `take_instruments` — "what was played", the superset of "what has its own
 * file" — must contain it. Without this, a take that is literally serving a
 * bass stem would be missing from a "takes with bass" search.
 *
 * Idempotent via the composite PK, so it needs no read-then-write and no
 * batch. The reverse is NOT symmetric: deleting a stem does not remove the
 * instrument, because deleting a file does not un-play an instrument.
 */
export async function addInstrument(db: Db, takeId: string, instrumentId: string): Promise<void> {
  await db.insert(takeInstruments).values({ takeId, instrumentId }).onConflictDoNothing();
}

/**
 * Move every take from one event onto another, in one statement.
 *
 * The ONE place `eventId` moves, and the reason `UpdateTakeInput` deliberately
 * has none: a take belongs to the session it was recorded in, so this is not
 * an edit anyone makes to a single take. It exists for exactly one repair —
 * a rehearsal that ended up as two events because a human created it before
 * the bridge pushed its own, and the day is now split in half.
 */
export async function moveAllToEvent(
  db: Db,
  fromEventId: string,
  toEventId: string,
  updatedAt: number,
): Promise<void> {
  await db
    .update(takes)
    .set({ eventId: toEventId, updatedAt })
    .where(eq(takes.eventId, fromEventId));
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
    // Votes and pins go too. They used to be left behind: FKs are never
    // enforced here (`PRAGMA foreign_keys` stays off for D1 parity), so a
    // deleted take left rows in `votes` and `favorites` pointing at nothing —
    // harmless while the only caller was the ingest DELETE, which can only
    // touch an `uploading`/`new` take nobody has voted on, and a real leak the
    // moment a member could delete a published one.
    db
      .delete(votes)
      .where(eq(votes.takeId, id)),
    db.delete(favorites).where(and(eq(favorites.targetType, "take"), eq(favorites.targetId, id))),
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
 * Safety cap for `listUnvotedByMember`'s default (unrequested) limit — review
 * round 1's F6. That queue has no UI for paging past it (one member's unvoted
 * takes are naturally few), so this is a defensive ceiling rather than a real
 * pagination feature — but "no LIMIT at all" is still wrong even for a listing
 * that is SUPPOSED to stay small.
 *
 * `listBySong` used to share this cap. It pages properly now: a song
 * accumulates takes for as long as the band plays it, which is exactly the
 * shape a silent ceiling hides.
 */
const DEFAULT_TAKE_LIST_CAP = 500;

/** The ordering every per-song and per-event take listing shares. */
const TAKE_LIST_ORDER = [desc(takes.recordedAt), desc(takes.id)];

export interface ListBySongOptions {
  /** Which page to return. Omitted means the FIRST page — never all of them. */
  page?: PageArgs;
}

/**
 * One page of a song's takes, newest first.
 *
 * `recordedAt` alone is not unique — two takes recorded at the same instant
 * (or, in a test fixture, given the same literal timestamp) would otherwise
 * have non-contractual relative order, which under paging means one row shown
 * on two pages and another shown on none. `id` (uuidv7, itself roughly
 * time-ordered) is a real, deterministic tie-break.
 */
export async function listBySong(
  db: Db,
  songId: string,
  options: ListBySongOptions = {},
): Promise<Paged<Take>> {
  const limit = options.page?.limit ?? DEFAULT_PAGE_SIZE;
  const offset = options.page?.offset ?? 0;
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(takes)
      .where(and(eq(takes.songId, songId), bandVisibleCondition()))
      .orderBy(...TAKE_LIST_ORDER)
      .limit(limit)
      .offset(offset),
    countBySong(db, songId),
  ]);
  return { rows, total };
}

/**
 * Every take of a song, unpaged — for CASCADES, which have to touch each row
 * (deleting a song walks its takes to collect storage keys). Named for what it
 * does so that reaching for it on a browse surface reads as the mistake it
 * would be; `listBySong` is what a page wants.
 *
 * UNFILTERED by visibility on purpose: deleting a song must take its members'
 * private takes with it.
 */
export async function listAllBySong(db: Db, songId: string): Promise<Take[]> {
  return db
    .select()
    .from(takes)
    .where(eq(takes.songId, songId))
    .orderBy(...TAKE_LIST_ORDER);
}

export interface ListByEventOptions {
  /**
   * `"desc"` (default, newest first) matches every other take listing.
   * `"asc"` gives the order takes were actually recorded during that one
   * session — what the event detail page shows, since "first take of the
   * day first" is how a member reconstructs what happened that day.
   */
  order?: "asc" | "desc";
  /** Which page to return. Omitted means the FIRST page — never all of them. */
  page?: PageArgs;
}

/** One page of the takes recorded at one event. */
export async function listByEvent(
  db: Db,
  eventId: string,
  options: ListByEventOptions = {},
): Promise<Paged<Take>> {
  const direction = options.order === "asc" ? asc(takes.recordedAt) : desc(takes.recordedAt);
  // `id` follows the direction of the primary key rather than always
  // descending: under `asc` the tie-break has to agree with "earliest first",
  // or two takes stamped the same second read backwards relative to the rows
  // around them. See `listBySong` for why a tie-break is here at all.
  const tieBreak = options.order === "asc" ? asc(takes.id) : desc(takes.id);
  const limit = options.page?.limit ?? DEFAULT_PAGE_SIZE;
  const offset = options.page?.offset ?? 0;
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(takes)
      .where(and(eq(takes.eventId, eventId), bandVisibleCondition()))
      .orderBy(direction, tieBreak)
      .limit(limit)
      .offset(offset),
    countByEvent(db, eventId),
  ]);
  return { rows, total };
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
  const tieBreak = options.order === "asc" ? asc(takes.id) : desc(takes.id);
  const rows = await db
    .select()
    .from(takes)
    .where(and(inArray(takes.eventId, eventIds), bandVisibleCondition()))
    .orderBy(direction, tieBreak);

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
 * "Has all of these instruments", as a CONDITION rather than a list of ids.
 *
 * This used to run as a pre-pass: fetch every matching take id, then
 * `inArray(takes.id, ids)`. That is fine for a query that returns everything
 * and wrong for one that returns a page — page 40 still materialised the
 * whole match set to find 25 rows, `count(*)` could not be pushed into SQL at
 * all, and the bound-parameter list grew with the archive until D1's cap on
 * them would turn a large band's filter into a runtime error.
 *
 * As a subquery it is one statement the database can limit, offset and count.
 * Exported so `songsRepo.listWithStats` composes the SAME condition rather than
 * keeping a second copy of the AND semantics these tests pin.
 */
export function hasAllInstruments(db: Db, instrumentIds: string[]): SQL {
  return inArray(
    takes.id,
    db
      .select({ takeId: takeInstruments.takeId })
      .from(takeInstruments)
      .where(inArray(takeInstruments.instrumentId, instrumentIds))
      .groupBy(takeInstruments.takeId)
      // `distinct` matters: the same instrument listed twice against one take
      // must not count as two of the requested set.
      .having(sql`count(distinct ${takeInstruments.instrumentId}) = ${instrumentIds.length}`),
  );
}

/** Takes whose SONG matches `search`, by title or by any of its aliases. */
function songTextMatches(db: Db, search: string): SQL {
  const pattern = `%${escapeLikePattern(normalizeTitle(search))}%`;
  const byTitle = inArray(
    takes.songId,
    db
      .select({ id: songs.id })
      .from(songs)
      .where(sql`${songs.titleNorm} LIKE ${pattern} ESCAPE '\\'`),
  );
  const byAlias = inArray(
    takes.songId,
    db
      .select({ songId: songAliases.songId })
      .from(songAliases)
      .where(sql`${songAliases.aliasNorm} LIKE ${pattern} ESCAPE '\\'`),
  );
  // `or()` returns `undefined` only for an empty argument list; two
  // conditions always produce one.
  return or(byTitle, byAlias) as SQL;
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

  return db
    .select()
    .from(takes)
    .where(and(hasAllInstruments(db, instrumentIds), bandVisibleCondition()))
    .orderBy(desc(takes.recordedAt), desc(takes.id));
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
      .where(
        and(eq(takes.state, "published"), votableCondition(), notInArray(takes.id, votedTakeIds)),
      )
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
  /** Only takes of this song. */
  songId?: string;
  /**
   * Restrict to takes this member has NOT voted on. The same `NOT IN (voted
   * take ids)` subquery `listUnvotedByMember` uses, expressed here as a filter
   * so it COMPOSES: "what haven't I judged" is a question a member asks about
   * a slice of the archive (this instrument, this month), and answering it by
   * filtering `listUnvotedByMember`'s output afterwards would apply the search
   * cap before the filter and silently return fewer takes than match.
   */
  unvotedByMemberId?: string;
}

/**
 * `"recent"` (default) — newest first, same as every other take listing.
 * `"rating"` — `keeperVotes DESC, ratingScore DESC`: a
 * take with 6 keeper votes out of 7 outranks one with 1 keeper vote out of
 * 1, even though the second has a higher `ratingScore` (1.0 vs ~0.86) — vote
 * COUNT is the primary key precisely so a single enthusiastic vote can't
 * outrank a take the whole band has actually weighed in on. `ratingScore`
 * only breaks a tie between takes with the same `keeperVotes`.
 */
export type TakeSort = "recent" | "rating";

export interface SearchOptions {
  /** Defaults to `"recent"`. */
  sort?: TakeSort;
  /** Which page to return. Omitted means the FIRST page — never all of them. */
  page?: PageArgs;
}

/**
 * `rows` is one page; `total` is every take matching the filters.
 *
 * This replaced a `truncated` boolean over a hard cap of 200. That flag could
 * say "there are more" but never how many, which is why `/takes` had to hedge
 * its count as "200+ takes" — true, useless, and indistinguishable from an
 * archive that really did hold exactly 200. A real total is one `count(*)`
 * over conditions the query has already built.
 */
export type SearchResult = Paged<Take>;

/**
 * The filter conditions, built once and used by BOTH the page query and the
 * count. Two hand-maintained copies of this list is how a listing ends up
 * reporting a total that disagrees with the rows under it.
 */
function searchConditions(db: Db, filters: SearchFilters): SQL[] {
  const conditions: SQL[] = [bandVisibleCondition()];

  if (filters.instrumentIds && filters.instrumentIds.length > 0) {
    conditions.push(hasAllInstruments(db, filters.instrumentIds));
  }
  if (filters.search) {
    conditions.push(songTextMatches(db, filters.search));
  }
  if (filters.songId) {
    conditions.push(eq(takes.songId, filters.songId));
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
  if (filters.unvotedByMemberId) {
    const votedTakeIds = db
      .select({ takeId: votes.takeId })
      .from(votes)
      .where(eq(votes.memberId, filters.unvotedByMemberId));
    // `published` is part of the filter, not a separate concern: an unpublished
    // take is not something anyone is being asked to judge, so "waiting for my
    // ear" would otherwise count takes still uploading.
    conditions.push(eq(takes.state, "published"));
    conditions.push(votableCondition());
    conditions.push(notInArray(takes.id, votedTakeIds));
  }

  return conditions;
}

export async function search(
  db: Db,
  filters: SearchFilters = {},
  options: SearchOptions = {},
): Promise<SearchResult> {
  const limit = options.page?.limit ?? DEFAULT_PAGE_SIZE;
  const offset = options.page?.offset ?? 0;
  const conditions = searchConditions(db, filters);
  const where = and(...conditions);

  // `desc(takes.id)` is the same deterministic tie-break `listBySong` uses —
  // see its comment. It is the LAST key in both orderings (after whatever the
  // sort mode itself ranks by), so it only ever breaks a tie the sort mode
  // left open, never overrides it. Under paging it stopped being a nicety:
  // without it two takes tied on the sort key can land on two different pages,
  // or on the same page twice.
  const orderBy =
    options.sort === "rating"
      ? [desc(takes.keeperVotes), desc(takes.ratingScore), desc(takes.recordedAt), desc(takes.id)]
      : [desc(takes.recordedAt), desc(takes.id)];

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(takes)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ value: sql<number>`count(*)` }).from(takes).where(where),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}

/** How many takes exist of one song — the count, without the rows. */
export async function countBySong(db: Db, songId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(takes)
    .where(and(eq(takes.songId, songId), bandVisibleCondition()));
  return rows[0]?.value ?? 0;
}

/** How many takes were recorded at one event — the count, without the rows. */
export async function countByEvent(db: Db, eventId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(takes)
    .where(and(eq(takes.eventId, eventId), bandVisibleCondition()));
  return rows[0]?.value ?? 0;
}

/**
 * How many takes each of these songs has, as a `Map` keyed by song id.
 *
 * Home rendered this by calling `listBySong` per pinned song and taking
 * `.length` — one query per pin, each pulling every take ROW of that song
 * across the wire to arrive at an integer. This is one query that counts.
 * Callers dedupe `songIds` themselves, matching `listInstrumentsForTakes`.
 */
export async function countBySongs(db: Db, songIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (songIds.length === 0) {
    return result;
  }
  const rows = await db
    .select({ songId: takes.songId, value: sql<number>`count(*)` })
    .from(takes)
    .where(and(inArray(takes.songId, songIds), bandVisibleCondition()))
    .groupBy(takes.songId);
  for (const row of rows) {
    // `songId` is nullable since 0011, but `inArray` already excluded NULL —
    // this is the typechecker asking, not a case that happens.
    if (row.songId !== null) {
      result.set(row.songId, row.value);
    }
  }
  return result;
}

/** `countBySongs`, per event — same reason, same shape. */
export async function countByEvents(db: Db, eventIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (eventIds.length === 0) {
    return result;
  }
  const rows = await db
    .select({ eventId: takes.eventId, value: sql<number>`count(*)` })
    .from(takes)
    .where(and(inArray(takes.eventId, eventIds), bandVisibleCondition()))
    .groupBy(takes.eventId);
  for (const row of rows) {
    result.set(row.eventId, row.value);
  }
  return result;
}

// D1 allows at most 100 bound parameters per statement — see `chunk.ts`.
// 90, not 100: this query's `inArray(members.id, ids)` isn't the only bound
// value — `eq(takes.state, "published")` binds one more — so a full 100-id
// chunk would ship 101 params. The "chunking stays under D1's 100-parameter
// limit" test below asserts this with `toSQL()`.
const MEMBER_CHUNK_SIZE = 90;

/**
 * Builds (without executing) one chunk's query for `countUnvotedByMembers`.
 * Exported for testing only, so `takes.test.ts` can assert the actual bound
 * parameter count via `.toSQL()` rather than trusting a comment: `ids` is
 * NOT the query's only bound parameter — `eq(takes.state, "published")`
 * binds one too, which is why `MEMBER_CHUNK_SIZE` is 90, not the full 100.
 */
export function buildCountUnvotedByMembersChunkQuery(db: Db, ids: string[]) {
  return db
    .select({ memberId: members.id, value: sql<number>`count(*)` })
    .from(members)
    .innerJoin(takes, and(eq(takes.state, "published"), votableCondition()))
    .leftJoin(votes, and(eq(votes.takeId, takes.id), eq(votes.memberId, members.id)))
    .where(and(inArray(members.id, ids), isNull(votes.takeId)))
    .groupBy(members.id);
}

/**
 * How many published takes each of the given members has NOT yet voted on —
 * the weekly reminder tick's recipient selection ("≥1 unvoted published
 * take"). Deliberately no cap the way `listUnvotedByMember`'s default limit
 * caps a single member's ROWS (`DEFAULT_TAKE_LIST_CAP`): this returns one
 * integer per member, not a row list, so there is nothing there for a cap
 * to protect against — a member with 900 unvoted takes still needs the real
 * number 900 in the push copy ("N nahrávek k hlasování"), not a capped one.
 *
 * Only members with a count > 0 appear in the returned map — a member with
 * nothing to vote on gets no weekly push, and "0" is never a value the tick
 * needs to see. `memberIds` is chunked (`chunk.ts`) so a large member list
 * never exceeds D1's bound-parameter cap on one statement; each chunk's
 * rows merge into one map, which is safe here because every member id is
 * looked up in exactly one chunk.
 */
export async function countUnvotedByMembers(
  db: Db,
  memberIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (memberIds.length === 0) {
    return result;
  }

  for (const ids of chunk(memberIds, MEMBER_CHUNK_SIZE)) {
    const rows = await buildCountUnvotedByMembersChunkQuery(db, ids);
    for (const row of rows) {
      result.set(row.memberId, row.value);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// the stash
// ---------------------------------------------------------------------------

export interface StashOptions {
  /** Only this song's — the song page's "Ve tvém šuplíku: N". */
  songId?: string;
}

function stashConditions(memberId: string, options: StashOptions): SQL[] {
  const conditions: SQL[] = [eq(takes.ownerMemberId, memberId), eq(takes.visibility, "private")];
  if (options.songId) {
    conditions.push(eq(takes.songId, options.songId));
  }
  return conditions;
}

/**
 * One member's stash, newest first. Unpaged with the same defensive ceiling
 * `listUnvotedByMember` uses: a stash is ideas waiting to be sorted, and a
 * member with 500 of them has a different problem than paging.
 */
export async function listStash(
  db: Db,
  memberId: string,
  options: StashOptions = {},
): Promise<Take[]> {
  return db
    .select()
    .from(takes)
    .where(and(...stashConditions(memberId, options)))
    .orderBy(desc(takes.recordedAt), desc(takes.id))
    .limit(DEFAULT_TAKE_LIST_CAP);
}

export async function countStash(
  db: Db,
  memberId: string,
  options: StashOptions = {},
): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(takes)
    .where(and(...stashConditions(memberId, options)));
  return rows[0]?.value ?? 0;
}

export type PublishFromStashResult =
  | "ok"
  /** Not this member's, not private any more, or gone. A second press lands here. */
  | "not_found"
  /**
   * The take has no song and the caller named none. The floor under the
   * invariant: this is the one write that turns a private take band-visible,
   * so it is the one place a songless take could cross into the band's view.
   */
  | "no_song";

/**
 * "Přidat k písni": one statement that moves a stash take into the band's view,
 * optionally filing it under the song chosen on the way out.
 *
 * `push_batched_at` is stamped with `published_at` in the same write, so the
 * new-takes tick has nothing to announce — a personal recording never pushes.
 * (`notificationsRepo` also filters owned takes out, so this holds even if an
 * admin later unpublishes and republishes it.) Conditional on owner AND
 * `private`, so a second press, or anyone else's press, changes nothing.
 *
 * `songId` is set in the SAME statement rather than in an update before it: a
 * recording that got its song and then failed to publish would be a private
 * take silently refiled under a song its owner only offered conditionally. It
 * goes in through `coalesce`, so it FILLS a missing song and never overwrites
 * one that is already there — a stale form cannot refile somebody's recording.
 * When no `songId` is given, the WHERE clause insists the take already has
 * one, so nothing songless can become band-visible even under a race.
 *
 * The follow-up read only happens when the write moved nothing, to tell the
 * two refusals apart — there is no partial write to be atomic about by then.
 */
export async function publishFromStash(
  db: Db,
  id: string,
  memberId: string,
  now: number,
  songId?: string | null,
): Promise<PublishFromStashResult> {
  const conditions = [
    eq(takes.id, id),
    eq(takes.ownerMemberId, memberId),
    eq(takes.visibility, "private"),
  ];
  if (!songId) {
    conditions.push(isNotNull(takes.songId));
  }
  const rows = await db
    .update(takes)
    .set({
      ...(songId ? { songId: sql`coalesce(${takes.songId}, ${songId})` } : {}),
      visibility: "band",
      state: "published",
      publishedAt: now,
      pushBatchedAt: now,
      updatedAt: now,
    })
    .where(and(...conditions))
    .returning({ id: takes.id });
  if (rows.length === 1) {
    return "ok";
  }
  const take = await getById(db, id);
  if (
    take &&
    take.ownerMemberId === memberId &&
    take.visibility === "private" &&
    take.songId === null
  ) {
    return "no_song";
  }
  return "not_found";
}

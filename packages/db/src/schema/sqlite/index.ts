// Drizzle SQLite schema — single source of truth for the bandplate data
// model. Runtime-agnostic (no node:* imports); runs on both libSQL
// (container) and D1 (Workers, increment 7).
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// column helpers — the repeated id()/ts() shapes, defined once
// ---------------------------------------------------------------------------

// Note: these helpers live in this file (rather than a sibling module) on
// purpose. drizzle-kit's schema loader resolves relative imports with a
// plain Node `require`, which cannot follow the `./foo.js` specifier (this
// repo's ESM convention, needed for real runtime execution under tsx/Node)
// back to a sibling `foo.ts` source file. Keeping the schema self-contained
// in one file sidesteps that entirely and matches the brief's file layout.

/**
 * Primary key column shape used by every table that has a single-column
 * UUIDv7 primary key (as opposed to the composite-PK join tables).
 */
function id() {
  return text("id").primaryKey();
}

/**
 * Timestamp column shape: epoch milliseconds stored as an integer.
 */
function ts(name: string) {
  return integer(name, { mode: "number" });
}

// ---------------------------------------------------------------------------
// members / auth
// ---------------------------------------------------------------------------

export const members = sqliteTable("members", {
  id: id(),
  displayName: text("display_name").notNull(),
  slug: text("slug").notNull().unique(),
  // The login whitelist: normalized (lowercased, trimmed) before storage.
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["admin", "member"] })
    .notNull()
    .default("member"),
  status: text("status", { enum: ["invited", "active", "disabled"] })
    .notNull()
    .default("invited"),
  createdAt: ts("created_at").notNull(),
  emailVerifiedAt: ts("email_verified_at"),
  // Which language this member reads the app in — the setting they change on
  // `/me`. Its own typed column, the shape `role` and `status` already use,
  // rather than a preferences blob: it is a scalar enum, it is read on every
  // single request through `resolveSession`, and a JSON column would make that
  // a parse instead of a column read.
  //
  // The values are spelled out rather than imported from `@bandplate/i18n`'s
  // `LOCALES`, which is where they are really defined. `drizzle-kit generate`
  // loads THIS FILE through a CJS require, and chokes on that package's
  // ESM-style `./locale.js` specifiers — so importing here would trade a
  // duplicated two-item list for a broken migration command. `locale.test.ts`
  // asserts the two lists agree, which is the guarantee the import was for.
  locale: text("locale", { enum: ["en", "cs"] })
    .notNull()
    .default("en"),
});

export const loginTokens = sqliteTable(
  "login_tokens",
  {
    id: id(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    requestedIp: text("requested_ip"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("login_tokens_member_id_idx").on(t.memberId)],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: id(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: ts("created_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    userAgent: text("user_agent"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("auth_sessions_member_id_idx").on(t.memberId)],
);

export const serviceTokens = sqliteTable("service_tokens", {
  id: id(),
  label: text("label").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes", { mode: "json" }).notNull().default([]).$type<string[]>(),
  createdAt: ts("created_at").notNull(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

// ---------------------------------------------------------------------------
// instruments
// ---------------------------------------------------------------------------

// Admin-managed data — archived, never deleted, so historical takes keep
// rendering an instrument the band has dropped.
export const instruments = sqliteTable("instruments", {
  id: id(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /**
   * Which vendored glyph this instrument shows, or null for none.
   *
   * A CHOICE, not a lookup on `slug`: this table is admin-managed data, so a
   * slug-keyed icon map could never be complete — a band adds a melodica and
   * the map has no entry. Storing the key here makes the set open, and makes
   * adding an instrument a matter of picking a glyph rather than shipping code.
   *
   * Nullable with no default and no backfill: null renders the instrument's
   * initials, which is a real presentation and also exactly what every
   * existing row shows on the day this ships. Keys come from
   * `@bandplate/ui/icons/instruments` and are validated against it on write —
   * an unknown key would render nothing at all.
   */
  icon: text("icon"),
  /**
   * Which colour the mixer paints this instrument's track with, or null.
   *
   * The same shape as `icon` directly above and for the same reasons: a KEY
   * from a registry (`@bandplate/ui/tokens/track-colors`), never a hex, so a
   * brand swap restyles every track without a data migration, and validated
   * on write because an unknown key would paint nothing.
   *
   * Nullable with no default and no backfill. Null is a real presentation —
   * the neutral `--bp-track-none` — and it is exactly what every existing row
   * shows on the day this ships. Deriving a colour by hashing the slug was
   * the alternative and is worse: it looks like a choice nobody made, and it
   * moves every lane's colour the day an instrument is renamed.
   *
   * Unlike `members.locale` this table has no positional raw `select`, so
   * there is no `assertColumnCount` to keep in step and the column can sit
   * beside the field it belongs with rather than being pinned last.
   */
  color: text("color"),
  /**
   * Created by ingest for a slug that was not in the vocabulary yet, and not
   * yet confirmed by a human.
   *
   * The same shape `songs.isStub` has, for the same reason: a bridge run must
   * not fail because the band miked something new, but a Reaper track name is
   * not a curated vocabulary entry either. A stub carries the slug it arrived
   * as and nothing else — no icon, no colour, a label to be written — and the
   * admin table says so until someone finishes it.
   *
   * It is what makes auto-creation safe at all. Rejecting unknown slugs was
   * the old answer (contract v1 §7) and the objection it was built on —
   * "BASS DI 2 would corrupt the filter vocabulary within one rehearsal" — is
   * answered by the row being visibly unfinished rather than by refusing it.
   */
  isStub: integer("is_stub", { mode: "boolean" }).notNull().default(false),
  archivedAt: ts("archived_at"),
});

// A member<->instrument relation was specified in the project plan (Task 6
// review, "data-model gap") but never made it into this schema — a
// transcription loss in the Task 2 brief, not a deliberate omission. Closing
// it now as a join table, the same shape as `takeInstruments` just below,
// rather than a JSON array column on `members` (the shape `serviceTokens.scopes`
// uses elsewhere in this file):
//   - A JSON array can't carry a foreign key, so an instrument rename/archive
//     would need an application-level fan-out write to every member row that
//     mentions it; a join table gets that for free (the instrument row is the
//     single source of truth, looked up by id).
//   - "Filtering members by instrument" isn't asked for today, but a join
//     table is what that would need if it ever is — a JSON array would have
//     to be restructured into one anyway. `takeInstruments` already made this
//     exact call for the same reasoning (see its own comment).
//   - Instruments are archivable, and archiving must not disturb a member's
//     existing association (the brief: "a member holding an archived
//     instrument must still render") — a plain FK with no cascade-on-archive
//     behavior (archiving only ever sets `archivedAt`, never deletes the row)
//     satisfies this by construction, the same way `takeInstruments` already
//     keeps rendering an instrument the band has dropped.
export const memberInstruments = sqliteTable(
  "member_instruments",
  {
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.instrumentId] }),
    // Reverse index, mirroring take_instruments' own — "everyone who plays
    // bass" as a single index scan. Nothing uses that query today, but the
    // table is shaped so it costs nothing to add later.
    index("member_instruments_instrument_id_member_id_idx").on(t.instrumentId, t.memberId),
  ],
);

/**
 * Other slugs that mean this instrument.
 *
 * Two jobs, and they are the same job from opposite ends. A bridge whose
 * Reaper session calls it `gtr2` can keep calling it that without anyone
 * editing a mapping file. And an instrument that should never have been its
 * own row — a stub ingest invented, a duplicate someone typed — is merged
 * into the real one, leaving its slug behind as an alias so the next bridge
 * run resolves it instead of inventing the stub again. Without that second
 * part a merge is undone by the very next ingest.
 *
 * Modelled on `song_aliases` down to the `source` column, for the same
 * reason it has one: an alias ingest recorded on a merge and an alias a human
 * typed are different things when someone is deciding whether it is safe to
 * remove.
 *
 * UNIQUE across the whole table, not per instrument: this is a lookup key,
 * and the same slug meaning two instruments is not a conflict to resolve at
 * read time but a thing that must never be written. What the schema CANNOT
 * say is that it must not collide with `instruments.slug` either — one
 * namespace across two tables — so `instrumentsRepo.addAlias` checks that
 * itself, and it is the only path that may write here.
 */
export const instrumentAliases = sqliteTable("instrument_aliases", {
  id: id(),
  instrumentId: text("instrument_id")
    .notNull()
    .references(() => instruments.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  source: text("source", { enum: ["manual", "ingest"] }).notNull(),
});

// ---------------------------------------------------------------------------
// songs
// ---------------------------------------------------------------------------

export const songs = sqliteTable(
  "songs",
  {
    id: id(),
    title: text("title").notNull(),
    // Produced by normalizeTitle(); shared by ingest matching and search.
    titleNorm: text("title_norm").notNull(),
    slug: text("slug").notNull().unique(),
    tempoBpm: real("tempo_bpm"),
    // Free text, e.g. "Am", "F# dorian".
    musicalKey: text("musical_key"),
    chordProgression: text("chord_progression"),
    lyrics: text("lyrics"),
    notes: text("notes"),
    // Auto-created by ingest when a take references an unrecognized title.
    isStub: integer("is_stub", { mode: "boolean" }).notNull().default(false),
    archivedAt: ts("archived_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    // UNIQUE (not just indexed): two concurrent stub creates for titles
    // that normalize the same (e.g. "Přítel (take 3)" and "Přítel - take
    // 5", both -> "pritel") must not both succeed — that would be a
    // permanent duplicate song, not a self-healing race the way the
    // `slug` UNIQUE constraint already makes title-identical concurrent
    // creates. Making this UNIQUE turns the loser into a catchable
    // constraint error `songsRepo.createWithAlias`'s caller re-fetches
    // and converges on, mirroring the slug case.
    uniqueIndex("songs_title_norm_idx").on(t.titleNorm),
  ],
);

export const songInstrumentNotes = sqliteTable(
  "song_instrument_notes",
  {
    songId: text("song_id")
      .notNull()
      .references(() => songs.id),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    body: text("body").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.songId, t.instrumentId] })],
);

export const songAliases = sqliteTable("song_aliases", {
  id: id(),
  songId: text("song_id")
    .notNull()
    .references(() => songs.id, { onDelete: "cascade" }),
  // Unique across the WHOLE table (not per-song) — used by both ingest
  // matching and search.
  aliasNorm: text("alias_norm").notNull().unique(),
  source: text("source", { enum: ["manual", "ingest"] }).notNull(),
});

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

export const events = sqliteTable(
  "events",
  {
    id: id(),
    kind: text("kind", { enum: ["rehearsal", "concert", "session"] }).notNull(),
    title: text("title"),
    heldAt: ts("held_at").notNull(),
    venue: text("venue"),
    notes: text("notes"),
    // Ingest idempotency key.
    clientRef: text("client_ref").unique(),
    archivedAt: ts("archived_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  // Deliberately NO (archived_at, held_at) index. The archive listing filters
  // `archived_at IS NULL` on top of this one, and at band scale — hundreds of
  // events — that costs nothing worth a second index's write amplification on
  // every ingest push. Same call as `songs.archived_at`, whose listing already
  // does a full group-by scan.
  (t) => [index("events_held_at_idx").on(t.heldAt)],
);

// ---------------------------------------------------------------------------
// takes
// ---------------------------------------------------------------------------

// Deliberately NO instrumentMask column (breaks once instruments are
// admin-editable/reorderable) and NO hasLossless column (a second source of
// truth that drifts when an asset is purged — see assets.takeHasLossless).
export const takes = sqliteTable(
  "takes",
  {
    id: id(),
    songId: text("song_id")
      .notNull()
      .references(() => songs.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    label: text("label"),
    recordedAt: ts("recorded_at").notNull(),
    durationMs: integer("duration_ms"),
    state: text("state", {
      enum: ["uploading", "new", "published", "keeper", "rejected", "purged"],
    })
      .notNull()
      .default("uploading"),
    keeperVotes: integer("keeper_votes").notNull().default(0),
    totalVotes: integer("total_votes").notNull().default(0),
    ratingScore: real("rating_score").notNull().default(0),
    clientRef: text("client_ref").unique(),
    notes: text("notes"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    publishedAt: ts("published_at"),
    purgedAt: ts("purged_at"),
  },
  (t) => [
    index("takes_song_id_recorded_at_idx").on(t.songId, t.recordedAt),
    index("takes_event_id_recorded_at_idx").on(t.eventId, t.recordedAt),
    index("takes_state_recorded_at_idx").on(t.state, t.recordedAt),
    index("takes_state_rating_score_idx").on(t.state, t.ratingScore),
  ],
);

export const takeInstruments = sqliteTable(
  "take_instruments",
  {
    takeId: text("take_id")
      .notNull()
      .references(() => takes.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
  },
  (t) => [
    primaryKey({ columns: [t.takeId, t.instrumentId] }),
    // Reverse index — makes "every take with bass on it" a single index scan.
    index("take_instruments_instrument_id_take_id_idx").on(t.instrumentId, t.takeId),
  ],
);

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------

export const assets = sqliteTable(
  "assets",
  {
    id: id(),
    takeId: text("take_id")
      .notNull()
      .references(() => takes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["master", "stem", "peaks"] }).notNull(),
    // Which instrument this row is about. NULL for a 'master'. For a
    // 'stem', the instrument played. For 'peaks', which SOURCE the waveform
    // describes: NULL is the master's shape, an id is that stem's — peaks
    // are per audio asset, so the picture can follow a solo (see
    // `peaksStorageKey`). The slot index below already keeps those apart.
    instrumentId: text("instrument_id").references(() => instruments.id),
    tier: text("tier", { enum: ["lossy", "lossless"] }).notNull(),
    format: text("format", { enum: ["opus", "mp3", "flac", "wav", "json"] }).notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256"),
    durationMs: integer("duration_ms"),
    sampleRate: integer("sample_rate"),
    channels: integer("channels"),
    status: text("status", { enum: ["pending", "ready", "missing", "purged"] })
      .notNull()
      .default("pending"),
    createdAt: ts("created_at").notNull(),
    readyAt: ts("ready_at"),
    purgedAt: ts("purged_at"),
  },
  (t) => [
    // instrumentId is nullable (NULL unless kind='stem'), and SQLite's
    // native UNIQUE index treats every NULL as distinct — two 'master' rows
    // (instrument_id NULL) on the same take would NOT collide on a plain
    // column index. Coalescing to '' makes the slot uniqueness hold for the
    // NULL case too.
    uniqueIndex("assets_slot_idx").on(
      t.takeId,
      t.kind,
      sql`coalesce(${t.instrumentId}, '')`,
      t.tier,
      t.format,
    ),
    index("assets_take_id_status_idx").on(t.takeId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// votes / favorites
// ---------------------------------------------------------------------------

export const votes = sqliteTable(
  "votes",
  {
    takeId: text("take_id")
      .notNull()
      .references(() => takes.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    keeper: integer("keeper", { mode: "boolean" }).notNull(),
    comment: text("comment"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.takeId, t.memberId] }),
    index("votes_member_id_updated_at_idx").on(t.memberId, t.updatedAt),
  ],
);

export const favorites = sqliteTable(
  "favorites",
  {
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    targetType: text("target_type", { enum: ["song", "take", "event"] }).notNull(),
    targetId: text("target_id").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.targetType, t.targetId] }),
    index("favorites_member_id_created_at_idx").on(t.memberId, t.createdAt),
  ],
);

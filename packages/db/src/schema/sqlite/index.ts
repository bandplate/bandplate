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

// A member<->instrument relation belongs in this schema but never made it
// in — an oversight, not a deliberate omission. Closing
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
//     existing association: a member holding an archived instrument must
//     still render — a plain FK with no cascade-on-archive
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
    // When a "chords/lyrics changed" push was last sent for this song, or
    // NULL if never. The CAS pivot for `notificationsRepo.claimSongNotification`
    // (`UPDATE songs SET chart_notified_at = :now WHERE id = :id AND
    // coalesce(chart_notified_at, 0) = :prev`) — see `song_chart_changes`
    // just below for what feeds it.
    chartNotifiedAt: ts("chart_notified_at"),
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
    kind: text("kind", { enum: ["rehearsal", "concert", "session", "personal"] }).notNull(),
    title: text("title"),
    heldAt: ts("held_at").notNull(),
    venue: text("venue"),
    notes: text("notes"),
    // Ingest idempotency key.
    clientRef: text("client_ref").unique(),
    archivedAt: ts("archived_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    // Whose stash day this is, for `kind = 'personal'` only — NULL on every
    // band event. A personal event holds one member's recordings from one Prague
    // day (see `eventsRepo.findOrCreatePersonal`), and exists because
    // `takes.event_id` is NOT NULL: a stash take needs an event from the moment
    // it is created. Hidden from every listing until it holds a band-visible
    // take — see `eventsRepo`'s `visibleToBandCondition`.
    //
    // No `.references(() => members.id)`, deliberately: FKs are never enforced
    // here (D1 parity), so the clause would be documentation only, and adding a
    // column WITH a reference is the shape drizzle-kit is most likely to turn
    // into a full table rebuild. This comment is the documentation instead.
    ownerMemberId: text("owner_member_id"),
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
    // NULLABLE since migration 0010: a recording can reach the stash before
    // its member has decided what song it is. The invariant the code keeps
    // (`takesRepo.create`, `publishFromStash`) is the other half: a take
    // whose `visibility` is `band` ALWAYS has a song, so no band-facing
    // listing, count or search can ever meet a songless row.
    songId: text("song_id").references(() => songs.id),
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
    // When this take's publication was last folded into a "new takes" push
    // batch — NULL means pending. Set alongside `publishedAt`, never
    // watermarked against it, so the ingest re-commit quirk (keeper/rejected
    // -> published, `publishedAt` reset) and an unpublish/republish cycle
    // each mark this NULL again rather than silently staying "already
    // notified". The migration backfills this to `publishedAt` for every
    // row that predates push notifications, or the first deploy would
    // announce the entire archive as one giant batch. See the partial index
    // `takes_push_pending_idx`, hand-added in the migration SQL (a raw
    // partial index isn't expressible through drizzle-kit's schema DSL).
    pushBatchedAt: ts("push_batched_at"),
    // The member whose recording this is, or NULL for a band take (ingest, the
    // upload panel). Set on every stash take and KEPT when it is published —
    // that is what marks a published take as a personal recording, which is
    // never voted on and never pushed (`takesRepo.isVotable`). Same no-FK
    // reasoning as `events.ownerMemberId`.
    ownerMemberId: text("owner_member_id"),
    // `private`: in its owner's stash, invisible to everyone else in every form
    // (no row, no count, no search hit). `band`: everything else, which is
    // every take that existed before this column did — hence the default.
    // Invariant, kept by code: `private` implies `ownerMemberId IS NOT NULL`.
    visibility: text("visibility", { enum: ["private", "band"] })
      .notNull()
      .default("band"),
  },
  (t) => [
    index("takes_song_id_recorded_at_idx").on(t.songId, t.recordedAt),
    index("takes_event_id_recorded_at_idx").on(t.eventId, t.recordedAt),
    index("takes_state_recorded_at_idx").on(t.state, t.recordedAt),
    index("takes_state_rating_score_idx").on(t.state, t.ratingScore),
    // The stash listing and counts: one member's private takes, newest first.
    index("takes_owner_member_id_visibility_recorded_at_idx").on(
      t.ownerMemberId,
      t.visibility,
      t.recordedAt,
    ),
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
    format: text("format", {
      enum: ["opus", "mp3", "flac", "wav", "json", "webm", "m4a"],
    }).notNull(),
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

// ---------------------------------------------------------------------------
// push notifications
// ---------------------------------------------------------------------------

/**
 * One Push API subscription (one browser/device). `endpoint` is UNIQUE and
 * is the upsert key — `pushSubscriptionsRepo.upsert` reassigns `memberId`
 * on conflict, so a device that switches which member is signed in on it
 * (a shared rehearsal-room tablet) stops notifying the old member the
 * moment it re-subscribes, rather than accumulating a second row.
 */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: id(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    // First 16 chars of the VAPID public key this subscription was created
    // under — lets a key rotation identify (and prompt a re-subscribe for)
    // subscriptions signed with a retired key, without storing the whole key
    // on every row.
    vapidKeyId: text("vapid_key_id").notNull(),
    // Which auth session was live when this device subscribed, or NULL —
    // informational only (not a foreign key enforced anywhere else either),
    // for support/debugging "why is this device still subscribed".
    authSessionId: text("auth_session_id"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    lastSuccessAt: ts("last_success_at"),
  },
  (t) => [index("push_subscriptions_member_id_idx").on(t.memberId)],
);

/**
 * Per-member notification toggles, three booleans (default on) plus their
 * own `updatedAt`. A dedicated table rather than columns on `members` — see
 * `membersRepo.buildCreateIfEmptyStatement`'s positional bootstrap insert,
 * guarded by `assertColumnCount(members, 9)`, which a new `members` column
 * would silently misalign. No row for a member means "all three on" —
 * `notificationPrefsRepo.get`'s default — so a member who has never opened
 * `/me`'s notification section is still reachable.
 */
export const notificationPrefs = sqliteTable("notification_prefs", {
  memberId: text("member_id")
    .primaryKey()
    .references(() => members.id, { onDelete: "cascade" }),
  newTakes: integer("new_takes", { mode: "boolean" }).notNull().default(true),
  weeklyUnvoted: integer("weekly_unvoted", { mode: "boolean" }).notNull().default(true),
  songChanges: integer("song_changes", { mode: "boolean" }).notNull().default(true),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * One row per chord/lyrics-changing edit (or creation) of a song — what
 * `notificationsRepo.listPendingSongChanges`/`listSongChangesInWindow` read
 * to decide a song push is due and who made it (excluded from the push, so
 * nobody is notified about their own edit). Only `createSong`/`updateSong`
 * write here — ingest's stub-song creation never does, so the
 * archive's initial backfill and every ingest run stay silent.
 */
export const songChartChanges = sqliteTable(
  "song_chart_changes",
  {
    id: id(),
    songId: text("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    kind: text("kind", { enum: ["created", "edited"] }).notNull(),
    changedAt: ts("changed_at").notNull(),
  },
  (t) => [index("song_chart_changes_song_id_changed_at_idx").on(t.songId, t.changedAt)],
);

/**
 * Generic single-use claim rows for notifications that have no natural
 * column to CAS against — today, only the weekly reminder
 * (`weekly:{Prague date}:{memberId}`). `claimKey`'s `INSERT ... ON CONFLICT
 * DO NOTHING RETURNING` is the same claim-then-send shape as
 * `claimTakeBatch`/`claimSongNotification`, just keyed by an arbitrary
 * string instead of a row's own columns. `prune` deletes rows older than 60
 * days — the key format is only ever compared for equality, so a pruned
 * claim never resurrects a slot: that Sunday's push already went out or
 * never will, weeks in the past.
 */
export const notificationClaims = sqliteTable("notification_claims", {
  key: text("key").primaryKey(),
  createdAt: ts("created_at").notNull(),
});

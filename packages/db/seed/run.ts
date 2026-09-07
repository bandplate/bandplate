#!/usr/bin/env node
// Seed script — Node tooling (not part of the runtime library). Idempotent:
// safe to run against the same database file repeatedly. Example/demo data
// only — a generic band lineup, not any real band's roster.
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { masterStorageKey, normalizeTitle, peaksStorageKey, stemStorageKey } from "@bandplate/core";
import { createClient } from "@libsql/client";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { schema } from "../src/client.js";
import { resolveDatabaseUrl } from "../src/database-url.js";
import * as assetsRepo from "../src/repos/assets.js";
import * as eventsRepo from "../src/repos/events.js";
import * as favoritesRepo from "../src/repos/favorites.js";
import * as instrumentsRepo from "../src/repos/instruments.js";
import * as membersRepo from "../src/repos/members.js";
import * as songsRepo from "../src/repos/songs.js";
import * as takesRepo from "../src/repos/takes.js";
import * as votesRepo from "../src/repos/votes.js";
import instrumentsConfig from "./instruments.json" with { type: "json" };

const MIGRATIONS_FOLDER = new URL("../migrations/sqlite", import.meta.url).pathname;

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (n: number) => now - n * DAY_MS;

/**
 * Deterministic pseudo-random duration in [3min, 4min), derived from the
 * take's clientRef via FNV-1a rather than Math.random(). This is what
 * "deterministic" actually means here: two fresh seeds are NOT
 * byte-identical (each row gets its own uuidv7 id, and every `daysAgo(...)`
 * timestamp is anchored to `Date.now()` at seed time — see `now` above), but
 * every value that's *derived from the seed's own content* — this duration,
 * every relationship between rows, every relative ordering — comes out the
 * same on every run, rather than drifting the way `Math.random()` would.
 * FNV-1a's avalanche behavior also avoids the near-linear output you'd get
 * from a naive polynomial hash on clientRefs that differ only in a trailing
 * digit.
 */
function seededDurationMs(clientRef: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < clientRef.length; i++) {
    hash ^= clientRef.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 3 * 60 * 1000 + ((hash >>> 0) % (60 * 1000));
}

async function main() {
  // Shares `scripts/migrate.ts`'s resolver (see `../src/database-url.ts`):
  // `BANDPLATE_DATABASE_URL` is the name the app itself uses, `DATABASE_URL`
  // is the bare fallback, and — critically — neither being set is now a
  // loud failure here too, not a silent default to a local file that
  // nothing else opens (that silent default was the bug: the seed reported
  // success with real row counts against a database the app never reads).
  const url = resolveDatabaseUrl(process.env, "running the seed");
  if (url.startsWith("file:")) {
    await mkdir(dirname(url.slice("file:".length)), { recursive: true });
  }

  console.log(`Seeding ${url}`);
  const client = createClient({ url });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  // ---------------------------------------------------------------------
  // Instruments — seeded from the committed config, keyed by slug.
  // ---------------------------------------------------------------------
  const instrumentBySlug = new Map<string, string>();
  const existingInstruments = await instrumentsRepo.list(db, { includeArchived: true });
  for (const row of existingInstruments) {
    instrumentBySlug.set(row.slug, row.id);
  }
  for (const config of instrumentsConfig) {
    if (instrumentBySlug.has(config.slug)) {
      continue;
    }
    const created = await instrumentsRepo.create(db, config);
    instrumentBySlug.set(created.slug, created.id);
  }
  const instrument = (slug: string): string => {
    const id = instrumentBySlug.get(slug);
    if (!id) {
      throw new Error(`seed: unknown instrument slug ${slug}`);
    }
    return id;
  };

  // ---------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------
  const memberSeeds = [
    {
      displayName: "Alex Admin",
      slug: "alex",
      email: "admin@example.com",
      role: "admin" as const,
      status: "active" as const,
    },
    {
      displayName: "Bailey",
      slug: "bailey",
      email: "bailey@example.com",
      role: "member" as const,
      status: "active" as const,
    },
    {
      displayName: "Cass",
      slug: "cass",
      email: "cass@example.com",
      role: "member" as const,
      status: "active" as const,
    },
    {
      displayName: "Dee",
      slug: "dee",
      email: "dee@example.com",
      role: "member" as const,
      status: "active" as const,
    },
    {
      displayName: "Sam",
      slug: "sam",
      email: "sam@example.com",
      role: "member" as const,
      status: "invited" as const,
    },
  ];
  const memberByEmail = new Map<string, string>();
  for (const seed of memberSeeds) {
    const existing = await membersRepo.getByEmail(db, seed.email);
    if (existing) {
      memberByEmail.set(seed.email, existing.id);
      continue;
    }
    const created = await membersRepo.create(db, { ...seed, createdAt: daysAgo(200) });
    memberByEmail.set(seed.email, created.id);
  }
  const member = (email: string): string => {
    const id = memberByEmail.get(email);
    if (!id) {
      throw new Error(`seed: unknown member email ${email}`);
    }
    return id;
  };

  // ---------------------------------------------------------------------
  // Member instruments — which instruments each member plays, rendered on
  // `/me` and the admin roster. `setInstruments` is replace-all, so this is
  // safe to re-run. Dee's trombone is archived further down (once takes
  // reference it too) so `/me` has a real example of a member holding an
  // instrument the band has since dropped — the join keeps rendering it
  // regardless (see `memberInstruments`' schema comment).
  // ---------------------------------------------------------------------
  const memberInstrumentSeeds: Record<string, string[]> = {
    "admin@example.com": ["vocals"],
    "bailey@example.com": ["drums", "bass"],
    "cass@example.com": ["guitar", "vocals"],
    "dee@example.com": ["bass", "trombone"],
    "sam@example.com": ["keys", "trumpet"],
  };
  for (const [email, slugs] of Object.entries(memberInstrumentSeeds)) {
    await membersRepo.setInstruments(
      db,
      member(email),
      slugs.map((slug) => instrument(slug)),
    );
  }

  // ---------------------------------------------------------------------
  // Songs — chord progressions and lyrics are original demo content
  // written for this seed, not lyrics from any real song.
  // ---------------------------------------------------------------------
  const NEON_SKYLINE_CHORDS = [
    "Intro: Am - F - C - G",
    "Verse: Am - F - C - G (x2)",
    "Chorus: F - C - G - Am",
    "Bridge: Dm - Am - E - Am",
    "Outro: Am - F - C - G (fade)",
  ].join("\n");
  const NEON_SKYLINE_LYRICS = [
    "Verse 1",
    "Woke up under a neon skyline glow",
    "Counting cars that never seem to slow",
    "Got a bassline running through my chest",
    "This town don't know when to rest",
    "",
    "Chorus",
    "Hold on, hold on, we're almost home",
    "Headlights cutting through the chrome",
    "Hold on, hold on, don't let go",
    "Ride the neon skyline glow",
    "",
    "Verse 2",
    "Streetlights flicker like a second thought",
    "Every corner's a lesson that we caught",
    "Rolling slow past the old arcade",
    "Where the best mistakes were made",
    "",
    "Bridge",
    "Somewhere between the exit and the dawn",
    "We found the song we're building on",
  ].join("\n");
  const BASEMENT_TAPES_CHORDS = [
    "Intro: E - B - C#m - A",
    "Verse: E - B - C#m - A (x2)",
    "Chorus: A - E - B - C#m",
    "Outro: E (let ring)",
  ].join("\n");
  const BASEMENT_TAPES_LYRICS = [
    "Verse 1",
    "Down in the basement where the tape machine hums",
    "Counting out loud on our fingers and thumbs",
    "Secondhand amp buzzing low in the dark",
    "Chasing a sound that leaves its mark",
    "",
    "Chorus",
    "Press record, don't think twice",
    "We'll get it right on the second try",
    "Press record, roll the dice",
    "Someday we'll hear it and wonder why",
    "",
    "Verse 2",
    "Dust on the cables, coffee gone cold",
    "Same three chords but they never get old",
  ].join("\n");
  // This band actually sings in Czech — most of the "demo content" above is
  // English placeholder text, but the archive needs at least one real
  // example of the section vocabulary `song-text.ts` has to recognize
  // (Sloka/Refrén/Most/Předehra/Dohra, diacritics included) so it doesn't
  // go untested against the built server the way it did the first time.
  const CESTY_CHORDS = [
    "Předehra: Dm - C - Bb - A",
    "Sloka: Dm - C - Bb - A (x2)",
    "Refrén: Bb - A - Dm",
    "Most: Gm - A - Dm",
    "Dohra: Dm (doznívá)",
  ].join("\n");
  const CESTY_LYRICS = [
    "Sloka 1",
    "Jedeme dál po cestě, co nikdy nekončí",
    "Kolem nás míjí světla, co nikdo nespočítá",
    "",
    "Refrén",
    "Zpátky se nedívej, jeď dál",
    "Ať vítr fouká, jak chce",
    "",
    "Sloka 2",
    "Za oknem mizí města, jedno jak druhé",
    "My hrajeme dál, dokud nám bude chtít",
    "",
    "Most",
    "Někde na půli cesty najdeme domov",
  ].join("\n");

  const songSeeds = [
    {
      slug: "neon-skyline",
      title: "Neon Skyline",
      tempoBpm: 128,
      musicalKey: "Am",
      chordProgression: NEON_SKYLINE_CHORDS,
      lyrics: NEON_SKYLINE_LYRICS,
      notes: "Set closer. Bring the tempo up slightly live — it drags at 128 with a full room.",
    },
    {
      slug: "basement-tapes",
      title: "Basement Tapes",
      tempoBpm: 96,
      musicalKey: "E",
      chordProgression: BASEMENT_TAPES_CHORDS,
      lyrics: BASEMENT_TAPES_LYRICS,
    },
    {
      slug: "pisen-o-cestach",
      title: "Píseň o cestách",
      tempoBpm: 84,
      musicalKey: "Dm",
      chordProgression: CESTY_CHORDS,
      lyrics: CESTY_LYRICS,
    },
    { slug: "wildfire", title: "Wildfire", tempoBpm: 140, musicalKey: "G" },
    { slug: "slow-burn", title: "Slow Burn", tempoBpm: 72, musicalKey: "Dm" },
    { slug: "nightbus", title: "Nightbus", tempoBpm: 110, musicalKey: "C" },
    {
      slug: "because-the-night-cover",
      title: "Because the Night (cover)",
      tempoBpm: 100,
      musicalKey: "Em",
      notes: "One-off for the New Year Bash encore. Never rehearsed again — worth a second look.",
    },
    { slug: "untitled-jam-1", title: "Untitled Jam #1", isStub: true },
  ];
  const songBySlug = new Map<string, string>();
  for (const seed of songSeeds) {
    const existing = await songsRepo.getBySlug(db, seed.slug);
    if (existing) {
      songBySlug.set(seed.slug, existing.id);
      continue;
    }
    const created = await songsRepo.create(db, {
      ...seed,
      createdAt: daysAgo(360),
      updatedAt: daysAgo(360),
    });
    songBySlug.set(seed.slug, created.id);
  }
  const song = (slug: string): string => {
    const id = songBySlug.get(slug);
    if (!id) {
      throw new Error(`seed: unknown song slug ${slug}`);
    }
    return id;
  };

  // ---------------------------------------------------------------------
  // Song aliases — a genuine alternate/working title (manual) and a
  // Reaper-style external ref an ingest run would have created. Guarded by
  // `findByAlias` first since, unlike the other seed sections, `addAlias`
  // itself has no upsert path (aliasNorm is unique across the whole table).
  // ---------------------------------------------------------------------
  async function ensureAlias(
    songId: string,
    alias: string,
    source: songsRepo.SongAliasSource,
  ): Promise<void> {
    const existing = await songsRepo.findByAlias(db, normalizeTitle(alias));
    if (existing) {
      return;
    }
    await songsRepo.addAlias(db, songId, alias, source);
  }

  await ensureAlias(song("neon-skyline"), "Neon Skies", "manual");
  await ensureAlias(
    song("basement-tapes"),
    "reaper:region-guid:6F3A9C2E-4B7D-4E1A-9F2C-1D8E5A6B7C3D",
    "ingest",
  );
  await ensureAlias(song("wildfire"), "Forest Fire", "manual");

  // ---------------------------------------------------------------------
  // Per-instrument playing notes — setInstrumentNote is already an upsert.
  // ---------------------------------------------------------------------
  await songsRepo.setInstrumentNote(
    db,
    song("neon-skyline"),
    instrument("bass"),
    "Walking bass under the chorus — resist the urge to fill.",
    daysAgo(90),
  );
  await songsRepo.setInstrumentNote(
    db,
    song("neon-skyline"),
    instrument("drums"),
    "Half-time feel on the bridge, back to straight eighths for the last chorus.",
    daysAgo(90),
  );
  await songsRepo.setInstrumentNote(
    db,
    song("wildfire"),
    instrument("vocals"),
    "Melody sits high in the second verse — drop it an octave if the singer's voice is tired.",
    daysAgo(60),
  );

  // ---------------------------------------------------------------------
  // Events — rehearsals and two concerts, spread across a full year.
  // ---------------------------------------------------------------------
  const eventSeeds = [
    { clientRef: "seed-event-1", kind: "rehearsal" as const, heldAt: daysAgo(360) },
    { clientRef: "seed-event-2", kind: "rehearsal" as const, heldAt: daysAgo(300) },
    { clientRef: "seed-event-3", kind: "rehearsal" as const, heldAt: daysAgo(240) },
    {
      clientRef: "seed-event-4",
      kind: "concert" as const,
      heldAt: daysAgo(200),
      title: "New Year Bash",
      venue: "The Attic",
      notes: "First outing for the new setlist. Crowd was into it, but the monitor mix needs work.",
    },
    { clientRef: "seed-event-5", kind: "rehearsal" as const, heldAt: daysAgo(150) },
    {
      clientRef: "seed-event-6",
      kind: "rehearsal" as const,
      heldAt: daysAgo(120),
      notes: "Ran the spring setlist twice end to end.",
    },
    { clientRef: "seed-event-7", kind: "rehearsal" as const, heldAt: daysAgo(90) },
    {
      clientRef: "seed-event-8",
      kind: "concert" as const,
      heldAt: daysAgo(60),
      title: "Live at The Attic",
      venue: "The Attic",
      notes: "Sold out. PA mix was muddy in the low end — bass needs cutting live next time.",
    },
    { clientRef: "seed-event-9", kind: "rehearsal" as const, heldAt: daysAgo(30) },
    {
      clientRef: "seed-event-10",
      kind: "rehearsal" as const,
      heldAt: daysAgo(7),
      notes: "Quick run before the next show. Vocals still finding the new key on Wildfire.",
    },
  ];
  const eventByRef = new Map<string, string>();
  for (const seed of eventSeeds) {
    const [existing] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.clientRef, seed.clientRef))
      .limit(1);
    if (existing) {
      eventByRef.set(seed.clientRef, existing.id);
      continue;
    }
    const created = await eventsRepo.create(db, {
      ...seed,
      createdAt: seed.heldAt,
      updatedAt: seed.heldAt,
    });
    eventByRef.set(seed.clientRef, created.id);
  }
  const event = (ref: string): string => {
    const id = eventByRef.get(ref);
    if (!id) {
      throw new Error(`seed: unknown event ref ${ref}`);
    }
    return id;
  };

  // ---------------------------------------------------------------------
  // Takes — neon-skyline gets eight takes across the whole year (the
  // flagship song), because-the-night-cover gets exactly one (played
  // once, never rehearsed again), and untitled-jam-1 (a stub) gets none —
  // its page has to render a real "no takes yet" empty state.
  // ---------------------------------------------------------------------
  interface TakeSeed {
    clientRef: string;
    songSlug: string;
    eventRef: string;
    recordedAt: number;
    state: takesRepo.TakeState;
    instrumentSlugs: string[];
    label?: string;
  }

  const takeSeeds: TakeSeed[] = [
    // neon-skyline — eight takes, one per event across the year except the
    // very first concert.
    {
      clientRef: "seed-take-1",
      songSlug: "neon-skyline",
      eventRef: "seed-event-1",
      recordedAt: daysAgo(360),
      state: "published",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
    },
    {
      clientRef: "seed-take-2",
      songSlug: "neon-skyline",
      eventRef: "seed-event-3",
      recordedAt: daysAgo(240),
      state: "keeper",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
      label: "with new bridge",
    },
    {
      clientRef: "seed-take-3",
      songSlug: "neon-skyline",
      eventRef: "seed-event-5",
      recordedAt: daysAgo(150),
      state: "rejected",
      instrumentSlugs: ["drums", "bass", "guitar"],
    },
    {
      clientRef: "seed-take-4",
      songSlug: "neon-skyline",
      eventRef: "seed-event-6",
      recordedAt: daysAgo(120),
      state: "published",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals", "keys"],
    },
    {
      clientRef: "seed-take-5",
      songSlug: "neon-skyline",
      eventRef: "seed-event-7",
      recordedAt: daysAgo(90),
      state: "new",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
    },
    {
      clientRef: "seed-take-6",
      songSlug: "neon-skyline",
      eventRef: "seed-event-8",
      recordedAt: daysAgo(60),
      state: "keeper",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals", "trumpet", "trombone"],
      label: "live",
    },
    {
      clientRef: "seed-take-7",
      songSlug: "neon-skyline",
      eventRef: "seed-event-9",
      recordedAt: daysAgo(30),
      state: "new",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
    },
    {
      clientRef: "seed-take-8",
      songSlug: "neon-skyline",
      eventRef: "seed-event-10",
      recordedAt: daysAgo(7),
      state: "new",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
      label: "new arrangement attempt",
    },
    // basement-tapes — two takes.
    {
      clientRef: "seed-take-9",
      songSlug: "basement-tapes",
      eventRef: "seed-event-2",
      recordedAt: daysAgo(300),
      state: "published",
      instrumentSlugs: ["guitar", "vocals"],
    },
    {
      clientRef: "seed-take-10",
      songSlug: "basement-tapes",
      eventRef: "seed-event-7",
      recordedAt: daysAgo(90),
      state: "keeper",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals", "keys"],
    },
    // wildfire — three takes.
    {
      clientRef: "seed-take-11",
      songSlug: "wildfire",
      eventRef: "seed-event-3",
      recordedAt: daysAgo(240),
      state: "rejected",
      instrumentSlugs: ["drums", "bass", "guitar"],
    },
    {
      clientRef: "seed-take-12",
      songSlug: "wildfire",
      eventRef: "seed-event-8",
      recordedAt: daysAgo(60),
      state: "keeper",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals", "trumpet", "trombone"],
      label: "live",
    },
    {
      clientRef: "seed-take-13",
      songSlug: "wildfire",
      eventRef: "seed-event-10",
      recordedAt: daysAgo(7),
      state: "new",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
    },
    // slow-burn — two takes.
    {
      clientRef: "seed-take-14",
      songSlug: "slow-burn",
      eventRef: "seed-event-1",
      recordedAt: daysAgo(360),
      state: "rejected",
      instrumentSlugs: ["guitar", "vocals"],
    },
    {
      clientRef: "seed-take-15",
      songSlug: "slow-burn",
      eventRef: "seed-event-9",
      recordedAt: daysAgo(30),
      state: "published",
      instrumentSlugs: ["drums", "bass", "guitar", "keys", "vocals"],
    },
    // nightbus — two takes.
    {
      clientRef: "seed-take-16",
      songSlug: "nightbus",
      eventRef: "seed-event-4",
      recordedAt: daysAgo(200),
      state: "keeper",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
      label: "live",
    },
    {
      clientRef: "seed-take-17",
      songSlug: "nightbus",
      eventRef: "seed-event-10",
      recordedAt: daysAgo(7),
      state: "new",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
    },
    // because-the-night-cover — exactly one take, ever.
    {
      clientRef: "seed-take-18",
      songSlug: "because-the-night-cover",
      eventRef: "seed-event-8",
      recordedAt: daysAgo(60),
      state: "new",
      instrumentSlugs: ["guitar", "vocals"],
      label: "just for fun",
    },
    // untitled-jam-1 gets NO takes — it stays a stub with an empty state.
  ];

  const takeByRef = new Map<string, string>();
  for (const seed of takeSeeds) {
    const [existing] = await db
      .select()
      .from(schema.takes)
      .where(eq(schema.takes.clientRef, seed.clientRef))
      .limit(1);
    if (existing) {
      takeByRef.set(seed.clientRef, existing.id);
      continue;
    }
    const created = await takesRepo.create(db, {
      songId: song(seed.songSlug),
      eventId: event(seed.eventRef),
      recordedAt: seed.recordedAt,
      durationMs: seededDurationMs(seed.clientRef),
      state: seed.state,
      clientRef: seed.clientRef,
      label: seed.label ?? null,
      createdAt: seed.recordedAt,
      updatedAt: seed.recordedAt,
      instrumentIds: seed.instrumentSlugs.map(instrument),
    });
    takeByRef.set(seed.clientRef, created.id);
  }
  const take = (ref: string): string => {
    const id = takeByRef.get(ref);
    if (!id) {
      throw new Error(`seed: unknown take ref ${ref}`);
    }
    return id;
  };

  // ---------------------------------------------------------------------
  // Assets — DB rows only. Storage keys use the canonical layout
  // (`masterStorageKey`/`stemStorageKey`/`peaksStorageKey` from
  // `@bandplate/core` — see task-7-report.md), matching exactly what
  // `scripts/dev-upload-audio.ts` uploads real encoded audio to. Running
  // the seed alone does NOT put bytes in a bucket — the audio endpoint
  // will 404/error on these until that script (or a real ingest) has run
  // against the same S3-compatible storage. Lossy tier is mp3 (universal
  // browser decode support — see the S3_* config docs), not opus.
  //
  // seed-take-2 (the neon-skyline keeper) gets full stems + a lossless
  // master; seed-take-9 and a handful of others get only a lossy master
  // (no stems).
  // ---------------------------------------------------------------------
  // Idempotency is keyed on the *slot* (`assets_slot_idx`:
  // take_id/kind/instrument_id/tier/format is where the table's own unique
  // index lives), not on `storageKey`. A DB seeded before this task's
  // canonical `takes/{id}/{kind}/{tier}.{ext}` layout (and its opus→mp3
  // lossy-tier switch) has rows occupying these same slots under the old
  // flat keys/format — matching on storageKey alone would miss them and
  // try to INSERT a second row into the same slot, which the unique index
  // (correctly) rejects. So: look up by slot; if a row is already there but
  // under the old storageKey/format, migrate it in place instead of
  // inserting a duplicate. This keeps re-seeding an old-layout database
  // idempotent and convergent rather than crashing mid-run.
  async function ensureAsset(
    storageKey: string,
    input: Omit<assetsRepo.CreateAssetInput, "storageKey">,
  ) {
    const instrumentId = input.instrumentId ?? null;
    const [existing] = await db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.takeId, input.takeId),
          eq(schema.assets.kind, input.kind),
          instrumentId === null
            ? isNull(schema.assets.instrumentId)
            : eq(schema.assets.instrumentId, instrumentId),
          eq(schema.assets.tier, input.tier),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.storageKey === storageKey && existing.format === input.format) {
        return existing;
      }
      // Old-layout row in this slot — migrate to the canonical
      // storageKey/format rather than inserting a second row that would
      // collide with assets_slot_idx (same format) or leave a stale
      // duplicate "ready" asset behind for the take (different format).
      const [migrated] = await db
        .update(schema.assets)
        .set({
          storageKey,
          format: input.format,
          contentType: input.contentType,
          bytes: input.bytes,
          status: input.status ?? existing.status,
          durationMs: input.durationMs ?? existing.durationMs,
          readyAt: input.readyAt ?? existing.readyAt,
        })
        .where(eq(schema.assets.id, existing.id))
        .returning();
      if (!migrated) {
        throw new Error(`seed: failed to migrate asset ${existing.id} to ${storageKey}`);
      }
      return migrated;
    }

    const [created] = await assetsRepo.createMany(db, [{ ...input, storageKey }]);
    if (!created) {
      throw new Error(`seed: failed to create asset ${storageKey}`);
    }
    return created;
  }

  const stemsTakeId = take("seed-take-2");
  await ensureAsset(masterStorageKey(stemsTakeId, "lossy", "mp3"), {
    takeId: stemsTakeId,
    kind: "master",
    tier: "lossy",
    format: "mp3",
    contentType: "audio/mpeg",
    bytes: 4_200_000,
    status: "ready",
    durationMs: 210_000,
    createdAt: daysAgo(90),
    readyAt: daysAgo(90),
  });
  await ensureAsset(masterStorageKey(stemsTakeId, "lossless", "flac"), {
    takeId: stemsTakeId,
    kind: "master",
    tier: "lossless",
    format: "flac",
    contentType: "audio/flac",
    bytes: 32_000_000,
    status: "ready",
    durationMs: 210_000,
    createdAt: daysAgo(90),
    readyAt: daysAgo(90),
  });
  for (const slug of ["drums", "bass", "guitar", "vocals"]) {
    await ensureAsset(stemStorageKey(stemsTakeId, slug, "lossy", "mp3"), {
      takeId: stemsTakeId,
      kind: "stem",
      instrumentId: instrument(slug),
      tier: "lossy",
      format: "mp3",
      contentType: "audio/mpeg",
      bytes: 3_800_000,
      status: "ready",
      durationMs: 210_000,
      createdAt: daysAgo(90),
      readyAt: daysAgo(90),
    });
  }
  await ensureAsset(peaksStorageKey(stemsTakeId), {
    takeId: stemsTakeId,
    kind: "peaks",
    tier: "lossy",
    format: "json",
    contentType: "application/json",
    bytes: 12_000,
    status: "ready",
    createdAt: daysAgo(90),
    readyAt: daysAgo(90),
  });

  const masterOnlyTakeId = take("seed-take-9");
  await ensureAsset(masterStorageKey(masterOnlyTakeId, "lossy", "mp3"), {
    takeId: masterOnlyTakeId,
    kind: "master",
    tier: "lossy",
    format: "mp3",
    contentType: "audio/mpeg",
    bytes: 3_900_000,
    status: "ready",
    durationMs: 195_000,
    createdAt: daysAgo(300),
    readyAt: daysAgo(300),
  });

  // A couple more masters so listings have something to show.
  for (const ref of [
    "seed-take-1",
    "seed-take-6",
    "seed-take-12",
    "seed-take-16",
    "seed-take-18",
  ]) {
    const takeId = take(ref);
    await ensureAsset(masterStorageKey(takeId, "lossy", "mp3"), {
      takeId,
      kind: "master",
      tier: "lossy",
      format: "mp3",
      contentType: "audio/mpeg",
      bytes: 4_000_000,
      status: "ready",
      durationMs: 200_000,
      createdAt: now,
      readyAt: now,
    });
  }

  // ---------------------------------------------------------------------
  // Votes — varied keeper/skip patterns across members and takes.
  // castVote() upserts, so this loop is naturally idempotent.
  // ---------------------------------------------------------------------
  const voteSeeds: Array<{ takeRef: string; email: string; keeper: boolean; comment?: string }> = [
    { takeRef: "seed-take-1", email: "admin@example.com", keeper: true },
    { takeRef: "seed-take-1", email: "bailey@example.com", keeper: true },
    {
      takeRef: "seed-take-1",
      email: "cass@example.com",
      keeper: false,
      comment: "vocals are pitchy",
    },
    {
      takeRef: "seed-take-2",
      email: "admin@example.com",
      keeper: true,
      comment: "this is the one",
    },
    { takeRef: "seed-take-2", email: "bailey@example.com", keeper: true },
    { takeRef: "seed-take-2", email: "cass@example.com", keeper: true },
    { takeRef: "seed-take-2", email: "dee@example.com", keeper: true },
    { takeRef: "seed-take-5", email: "admin@example.com", keeper: true },
    { takeRef: "seed-take-5", email: "bailey@example.com", keeper: true },
    { takeRef: "seed-take-5", email: "cass@example.com", keeper: true },
    {
      takeRef: "seed-take-6",
      email: "admin@example.com",
      keeper: true,
      comment: "great energy live",
    },
    { takeRef: "seed-take-6", email: "bailey@example.com", keeper: true },
    { takeRef: "seed-take-7", email: "admin@example.com", keeper: true },
    { takeRef: "seed-take-7", email: "bailey@example.com", keeper: true },
    { takeRef: "seed-take-7", email: "cass@example.com", keeper: true },
    { takeRef: "seed-take-7", email: "dee@example.com", keeper: false },
    { takeRef: "seed-take-9", email: "admin@example.com", keeper: false },
    { takeRef: "seed-take-10", email: "admin@example.com", keeper: true },
    { takeRef: "seed-take-10", email: "cass@example.com", keeper: true },
    { takeRef: "seed-take-12", email: "admin@example.com", keeper: true },
    { takeRef: "seed-take-12", email: "bailey@example.com", keeper: true },
    { takeRef: "seed-take-12", email: "dee@example.com", keeper: true },
    { takeRef: "seed-take-11", email: "admin@example.com", keeper: false, comment: "tempo drifts" },
    { takeRef: "seed-take-16", email: "admin@example.com", keeper: true },
    { takeRef: "seed-take-16", email: "sam@example.com", keeper: true },
  ];
  for (const seed of voteSeeds) {
    await votesRepo.castVote(db, {
      takeId: take(seed.takeRef),
      memberId: member(seed.email),
      keeper: seed.keeper,
      comment: seed.comment ?? null,
      now: now,
    });
  }

  // ---------------------------------------------------------------------
  // Favorites
  // ---------------------------------------------------------------------
  const favoriteSeeds: Array<{
    email: string;
    targetType: favoritesRepo.FavoriteTargetType;
    targetId: string;
  }> = [
    { email: "admin@example.com", targetType: "song", targetId: song("neon-skyline") },
    { email: "admin@example.com", targetType: "event", targetId: event("seed-event-4") },
    { email: "bailey@example.com", targetType: "take", targetId: take("seed-take-2") },
    { email: "cass@example.com", targetType: "song", targetId: song("wildfire") },
  ];
  for (const seed of favoriteSeeds) {
    await favoritesRepo.add(db, {
      memberId: member(seed.email),
      targetType: seed.targetType,
      targetId: seed.targetId,
      createdAt: now,
    });
  }

  // ---------------------------------------------------------------------
  // Archive trombone — after everything above has already referenced it
  // (takes and Dee's member_instruments row both still do), so the seed
  // demonstrates the "archived instrument a member still holds" case
  // without deleting anything. Guarded so a re-run doesn't re-archive with
  // a fresh timestamp every time.
  // ---------------------------------------------------------------------
  const tromboneId = instrument("trombone");
  const trombone = await instrumentsRepo.getById(db, tromboneId);
  if (trombone && trombone.archivedAt === null) {
    await instrumentsRepo.archive(db, tromboneId, daysAgo(30));
  }

  console.log("Seed complete.");
  console.log(`  instruments: ${instrumentBySlug.size}`);
  console.log(`  members: ${memberByEmail.size}`);
  console.log(`  songs: ${songBySlug.size}`);
  console.log(`  events: ${eventByRef.size}`);
  console.log(`  takes: ${takeByRef.size}`);
  console.log(`  votes: ${voteSeeds.length}`);
  console.log(`  favorites: ${favoriteSeeds.length}`);
  console.log(
    `  member instruments: ${Object.keys(memberInstrumentSeeds).length} members assigned`,
  );

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

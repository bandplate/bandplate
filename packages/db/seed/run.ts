#!/usr/bin/env node
// Seed script — Node tooling (not part of the runtime library). Idempotent:
// safe to run against the same database file repeatedly. Example/demo data
// only — a generic band lineup, not any real band's roster.
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { schema } from "../src/client.js";
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
const DEFAULT_DB_PATH = new URL("../.data/dev.db", import.meta.url).pathname;

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (n: number) => now - n * DAY_MS;

async function main() {
  const url = process.env.DATABASE_URL ?? `file:${DEFAULT_DB_PATH}`;
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
  // Songs
  // ---------------------------------------------------------------------
  const songSeeds = [
    { slug: "neon-skyline", title: "Neon Skyline", tempoBpm: 128, musicalKey: "Am" },
    { slug: "basement-tapes", title: "Basement Tapes", tempoBpm: 96, musicalKey: "E" },
    { slug: "wildfire", title: "Wildfire", tempoBpm: 140, musicalKey: "G" },
    { slug: "slow-burn", title: "Slow Burn", tempoBpm: 72, musicalKey: "Dm" },
    { slug: "nightbus", title: "Nightbus", tempoBpm: 110, musicalKey: "C" },
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
      createdAt: daysAgo(180),
      updatedAt: daysAgo(180),
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
  // Events — a mix of rehearsals and one concert, spread over months.
  // ---------------------------------------------------------------------
  const eventSeeds = [
    { clientRef: "seed-event-1", kind: "rehearsal" as const, heldAt: daysAgo(150) },
    { clientRef: "seed-event-2", kind: "rehearsal" as const, heldAt: daysAgo(120) },
    { clientRef: "seed-event-3", kind: "rehearsal" as const, heldAt: daysAgo(90) },
    {
      clientRef: "seed-event-4",
      kind: "concert" as const,
      heldAt: daysAgo(60),
      title: "Live at The Attic",
      venue: "The Attic",
    },
    { clientRef: "seed-event-5", kind: "rehearsal" as const, heldAt: daysAgo(30) },
    { clientRef: "seed-event-6", kind: "rehearsal" as const, heldAt: daysAgo(7) },
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
  // Takes — several per song, across several events, varied state.
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
    {
      clientRef: "seed-take-1",
      songSlug: "neon-skyline",
      eventRef: "seed-event-1",
      recordedAt: daysAgo(150),
      state: "published",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
    },
    {
      clientRef: "seed-take-2",
      songSlug: "neon-skyline",
      eventRef: "seed-event-3",
      recordedAt: daysAgo(90),
      state: "keeper",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
      label: "with new bridge",
    },
    {
      clientRef: "seed-take-3",
      songSlug: "neon-skyline",
      eventRef: "seed-event-6",
      recordedAt: daysAgo(7),
      state: "new",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
    },
    {
      clientRef: "seed-take-4",
      songSlug: "basement-tapes",
      eventRef: "seed-event-2",
      recordedAt: daysAgo(120),
      state: "published",
      instrumentSlugs: ["guitar", "vocals"],
    },
    {
      clientRef: "seed-take-5",
      songSlug: "basement-tapes",
      eventRef: "seed-event-5",
      recordedAt: daysAgo(30),
      state: "keeper",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals", "keys"],
    },
    {
      clientRef: "seed-take-6",
      songSlug: "wildfire",
      eventRef: "seed-event-3",
      recordedAt: daysAgo(90),
      state: "rejected",
      instrumentSlugs: ["drums", "bass", "guitar"],
    },
    {
      clientRef: "seed-take-7",
      songSlug: "wildfire",
      eventRef: "seed-event-4",
      recordedAt: daysAgo(60),
      state: "keeper",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals", "trumpet", "trombone"],
      label: "live",
    },
    {
      clientRef: "seed-take-8",
      songSlug: "wildfire",
      eventRef: "seed-event-6",
      recordedAt: daysAgo(7),
      state: "new",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
    },
    {
      clientRef: "seed-take-9",
      songSlug: "slow-burn",
      eventRef: "seed-event-1",
      recordedAt: daysAgo(150),
      state: "rejected",
      instrumentSlugs: ["guitar", "vocals"],
    },
    {
      clientRef: "seed-take-10",
      songSlug: "slow-burn",
      eventRef: "seed-event-5",
      recordedAt: daysAgo(30),
      state: "published",
      instrumentSlugs: ["drums", "bass", "guitar", "keys", "vocals"],
    },
    {
      clientRef: "seed-take-11",
      songSlug: "nightbus",
      eventRef: "seed-event-4",
      recordedAt: daysAgo(60),
      state: "keeper",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
      label: "live",
    },
    {
      clientRef: "seed-take-12",
      songSlug: "nightbus",
      eventRef: "seed-event-6",
      recordedAt: daysAgo(7),
      state: "new",
      instrumentSlugs: ["drums", "bass", "guitar", "vocals"],
    },
    {
      clientRef: "seed-take-13",
      songSlug: "untitled-jam-1",
      eventRef: "seed-event-6",
      recordedAt: daysAgo(7),
      state: "new",
      instrumentSlugs: ["drums", "bass"],
    },
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
      durationMs: 3 * 60 * 1000 + Math.round(Math.random() * 60 * 1000),
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
  // Assets — seed-take-2 gets full stems + a lossless master; seed-take-4
  // gets only a lossy master (no stems).
  // ---------------------------------------------------------------------
  async function ensureAsset(
    storageKey: string,
    input: Omit<assetsRepo.CreateAssetInput, "storageKey">,
  ) {
    const [existing] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.storageKey, storageKey))
      .limit(1);
    if (existing) {
      return existing;
    }
    const [created] = await assetsRepo.createMany(db, [{ ...input, storageKey }]);
    if (!created) {
      throw new Error(`seed: failed to create asset ${storageKey}`);
    }
    return created;
  }

  const stemsTakeId = take("seed-take-2");
  await ensureAsset(`${stemsTakeId}/master.opus`, {
    takeId: stemsTakeId,
    kind: "master",
    tier: "lossy",
    format: "opus",
    contentType: "audio/opus",
    bytes: 4_200_000,
    status: "ready",
    durationMs: 210_000,
    createdAt: daysAgo(90),
    readyAt: daysAgo(90),
  });
  await ensureAsset(`${stemsTakeId}/master.flac`, {
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
    await ensureAsset(`${stemsTakeId}/stems/${slug}.opus`, {
      takeId: stemsTakeId,
      kind: "stem",
      instrumentId: instrument(slug),
      tier: "lossy",
      format: "opus",
      contentType: "audio/opus",
      bytes: 3_800_000,
      status: "ready",
      durationMs: 210_000,
      createdAt: daysAgo(90),
      readyAt: daysAgo(90),
    });
  }
  await ensureAsset(`${stemsTakeId}/peaks.json`, {
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

  const masterOnlyTakeId = take("seed-take-4");
  await ensureAsset(`${masterOnlyTakeId}/master.opus`, {
    takeId: masterOnlyTakeId,
    kind: "master",
    tier: "lossy",
    format: "opus",
    contentType: "audio/opus",
    bytes: 3_900_000,
    status: "ready",
    durationMs: 195_000,
    createdAt: daysAgo(120),
    readyAt: daysAgo(120),
  });

  // A couple more masters so listings have something to show.
  for (const ref of ["seed-take-7", "seed-take-10", "seed-take-11", "seed-take-13"]) {
    const takeId = take(ref);
    await ensureAsset(`${takeId}/master.opus`, {
      takeId,
      kind: "master",
      tier: "lossy",
      format: "opus",
      contentType: "audio/opus",
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
    { takeRef: "seed-take-6", email: "admin@example.com", keeper: false, comment: "tempo drifts" },
    { takeRef: "seed-take-6", email: "bailey@example.com", keeper: false },
    { takeRef: "seed-take-7", email: "admin@example.com", keeper: true },
    { takeRef: "seed-take-7", email: "bailey@example.com", keeper: true },
    { takeRef: "seed-take-7", email: "cass@example.com", keeper: true },
    { takeRef: "seed-take-7", email: "dee@example.com", keeper: false },
    { takeRef: "seed-take-9", email: "admin@example.com", keeper: false },
    { takeRef: "seed-take-10", email: "admin@example.com", keeper: true },
    { takeRef: "seed-take-10", email: "cass@example.com", keeper: true },
    { takeRef: "seed-take-11", email: "admin@example.com", keeper: true },
    { takeRef: "seed-take-11", email: "bailey@example.com", keeper: true },
    { takeRef: "seed-take-11", email: "dee@example.com", keeper: true },
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

  console.log("Seed complete.");
  console.log(`  instruments: ${instrumentBySlug.size}`);
  console.log(`  members: ${memberByEmail.size}`);
  console.log(`  songs: ${songBySlug.size}`);
  console.log(`  events: ${eventByRef.size}`);
  console.log(`  takes: ${takeByRef.size}`);
  console.log(`  votes: ${voteSeeds.length}`);
  console.log(`  favorites: ${favoriteSeeds.length}`);

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

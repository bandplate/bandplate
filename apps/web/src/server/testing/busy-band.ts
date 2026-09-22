// A band with a few weeks of history, for the tests that count what a page
// costs. Every branch of home, `/me` and `/takes` has something to find:
//
// - new takes published since the member's last visit, some voted, some not
// - pins of every kind: songs, band takes, a take of another member's personal
//   day, a band event and another member's personal day, plus an archived song
// - votes, some on takes an admin has since settled as keeper or rejected
// - a stash with a songless recording (the stash view then offers songs)
// - playable masters on some takes, instruments on all of them
//
// Test support only.
import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  favoritesRepo,
  instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface BusyBand {
  db: Db;
  /** The member whose pages are loaded. */
  memberId: string;
  /** When the member last loaded home: before the newest event's takes went out. */
  lastSeenAt: number;
  /** "Now" for every loader, well past the visit gap. */
  now: number;
  /** The four band events, oldest first. */
  bandEventIds: string[];
  /** Another member's personal day, with a published recording of theirs in it. */
  personalEventId: string;
  /** Whose personal day that is. */
  personalOwnerId: string;
}

export interface BusyBandOptions {
  /**
   * Extra published takes in the oldest event, each with a player, so a grown
   * list page holds more ids than one statement may bind.
   */
  extraTakes?: number;
}

export async function seedBusyBand(options: BusyBandOptions = {}): Promise<BusyBand> {
  const db = await createTestDb();
  const start = Date.UTC(2026, 7, 1, 18, 0, 0);
  const now = start + 30 * DAY;
  const lastSeenAt = now - 2 * DAY;

  const member = await membersRepo.create(db, {
    displayName: "Anna Nováková",
    slug: "anna",
    email: "anna@example.com",
    createdAt: start,
  });
  const others = [];
  for (const [name, slug] of [
    ["Bára", "bara"],
    ["Cyril", "cyril"],
  ] as const) {
    others.push(
      await membersRepo.create(db, {
        displayName: name,
        slug,
        email: `${slug}@example.com`,
        createdAt: start,
      }),
    );
  }
  const [bara, cyril] = others as [membersRepo.Member, membersRepo.Member];
  await membersRepo.recordHomeLoad(db, member.id, {
    previousLastSeenAt: null,
    lastSeenAt,
    lastVisitAt: lastSeenAt - DAY,
  });

  const instruments = [];
  for (const [slug, label] of [
    ["bass", "Bass"],
    ["drums", "Drums"],
    ["keys", "Keys"],
  ] as const) {
    instruments.push(await instrumentsRepo.create(db, { slug, label }));
  }
  await membersRepo.setInstruments(db, member.id, [instruments[0]?.id ?? ""]);

  const songs = [];
  for (let i = 0; i < 6; i += 1) {
    songs.push(
      await songsRepo.create(db, {
        title: `Song ${i}`,
        slug: `song-${i}`,
        createdAt: start,
        updatedAt: start,
      }),
    );
  }
  const archivedSong = songs[5] as songsRepo.Song;
  await songsRepo.update(db, archivedSong.id, { archivedAt: start + DAY, updatedAt: start });

  // Four band events a week apart; the last one's takes are the "new" ones.
  const bandEvents = [];
  const bandTakes: takesRepo.Take[] = [];
  for (let e = 0; e < 4; e += 1) {
    const heldAt = start + e * 7 * DAY;
    const event = await eventsRepo.create(db, {
      kind: e === 2 ? "concert" : "rehearsal",
      heldAt,
      createdAt: heldAt,
      updatedAt: heldAt,
    });
    bandEvents.push(event);
    const publishedAt = e === 3 ? lastSeenAt + HOUR : heldAt + DAY;
    for (let t = 0; t < 4; t += 1) {
      const song = songs[(e + t) % 5] as songsRepo.Song;
      const take = await takesRepo.create(db, {
        songId: song.id,
        eventId: event.id,
        recordedAt: heldAt + t * HOUR,
        instrumentIds: instruments.slice(0, 1 + (t % 3)).map((i) => i.id),
        createdAt: heldAt,
        updatedAt: heldAt,
      });
      await takesRepo.setStateWithPublishedAt(db, take.id, "published", publishedAt, publishedAt);
      bandTakes.push(take);
      if (t % 2 === 0) {
        await assetsRepo.createMany(db, [
          {
            takeId: take.id,
            kind: "master",
            tier: "lossy",
            format: "opus",
            storageKey: `takes/${take.id}/master/lossy.opus`,
            contentType: "audio/opus",
            bytes: 1000,
            status: "ready",
            createdAt: heldAt,
            readyAt: heldAt,
          },
        ]);
      }
    }
  }

  const oldest = bandEvents[0] as eventsRepo.Event;
  for (let i = 0; i < (options.extraTakes ?? 0); i += 1) {
    const take = await takesRepo.create(db, {
      songId: (songs[4] as songsRepo.Song).id,
      eventId: oldest.id,
      recordedAt: oldest.heldAt - (i + 1) * 60_000,
      instrumentIds: [(instruments[1] as instrumentsRepo.Instrument).id],
      createdAt: oldest.heldAt,
      updatedAt: oldest.heldAt,
    });
    await takesRepo.setStateWithPublishedAt(db, take.id, "published", oldest.heldAt, oldest.heldAt);
    await assetsRepo.createMany(db, [
      {
        takeId: take.id,
        kind: "master",
        tier: "lossy",
        format: "opus",
        storageKey: `takes/${take.id}/master/lossy.opus`,
        contentType: "audio/opus",
        bytes: 1000,
        status: "ready",
        createdAt: oldest.heldAt,
        readyAt: oldest.heldAt,
      },
    ]);
  }

  // Another member's personal day, with a published recording of theirs.
  const baraDay = await eventsRepo.findOrCreatePersonal(db, {
    memberId: bara.id,
    dayKey: "2026-08-20",
    heldAt: start + 19 * DAY,
    now: start + 19 * DAY,
  });
  const baraTake = await takesRepo.create(db, {
    songId: (songs[1] as songsRepo.Song).id,
    eventId: baraDay.id,
    ownerMemberId: bara.id,
    recordedAt: start + 19 * DAY,
    instrumentIds: [(instruments[2] as instrumentsRepo.Instrument).id],
    createdAt: start + 19 * DAY,
    updatedAt: start + 19 * DAY,
  });
  await takesRepo.setStateWithPublishedAt(db, baraTake.id, "published", start + 19 * DAY, now);

  // Votes: most of the older takes, a couple of the new ones, and verdicts on two.
  const voted = [...bandTakes.slice(0, 10), ...bandTakes.slice(12, 14)];
  for (const [i, take] of voted.entries()) {
    await votesRepo.castVote(db, {
      takeId: take.id,
      memberId: member.id,
      keeper: i % 3 !== 0,
      now: start + (i + 1) * HOUR,
    });
    await votesRepo.castVote(db, {
      takeId: take.id,
      memberId: cyril.id,
      keeper: i % 2 === 0,
      now: start + (i + 1) * HOUR,
    });
  }
  await takesRepo.setState(db, (bandTakes[1] as takesRepo.Take).id, "keeper", now);
  await takesRepo.setState(db, (bandTakes[3] as takesRepo.Take).id, "rejected", now);

  // Pins, oldest first: every kind, and one that no longer shows (archived).
  const pins: [favoritesRepo.FavoriteTargetType, string][] = [
    ["song", (songs[0] as songsRepo.Song).id],
    ["take", (bandTakes[2] as takesRepo.Take).id],
    ["event", (bandEvents[1] as eventsRepo.Event).id],
    ["song", archivedSong.id],
    ["take", baraTake.id],
    ["event", baraDay.id],
    ["take", (bandTakes[13] as takesRepo.Take).id],
    ["song", (songs[3] as songsRepo.Song).id],
  ];
  for (const [i, [targetType, targetId]] of pins.entries()) {
    await favoritesRepo.add(db, {
      memberId: member.id,
      targetType,
      targetId,
      createdAt: start + i * HOUR,
    });
  }

  // The member's own stash: one filed under a song, one not decided yet.
  const ownDay = await eventsRepo.findOrCreatePersonal(db, {
    memberId: member.id,
    dayKey: "2026-08-28",
    heldAt: start + 27 * DAY,
    now: start + 27 * DAY,
  });
  for (const [i, songId] of [(songs[2] as songsRepo.Song).id, null].entries()) {
    const take = await takesRepo.create(db, {
      visibility: "private",
      ownerMemberId: member.id,
      songId,
      eventId: ownDay.id,
      recordedAt: start + 27 * DAY + i * HOUR,
      instrumentIds: [(instruments[0] as instrumentsRepo.Instrument).id],
      createdAt: start + 27 * DAY,
      updatedAt: start + 27 * DAY,
    });
    if (i === 0) {
      await assetsRepo.createMany(db, [
        {
          takeId: take.id,
          kind: "master",
          tier: "lossy",
          format: "opus",
          storageKey: `takes/${take.id}/master/lossy.opus`,
          contentType: "audio/opus",
          bytes: 1000,
          status: "ready",
          createdAt: start + 27 * DAY,
          readyAt: start + 27 * DAY,
        },
      ]);
    }
  }

  return {
    db,
    memberId: member.id,
    lastSeenAt,
    now,
    bandEventIds: bandEvents.map((event) => event.id),
    personalEventId: baraDay.id,
    personalOwnerId: bara.id,
  };
}

/** What `dressDetailPages` added, for the tests that load those pages. */
export interface DressedDetailPages {
  /** A song with aliases, a note, a folded take list, another member's recording and the member's own stash. */
  songSlug: string;
  /** The newest band event, which now has a same-day twin. */
  bandEventId: string;
}

/**
 * Fills in what only the song and event pages read, on top of `seedBusyBand`
 * and without changing anything the other pages count: "Song 2" gets an
 * alias, a playing note and a fourth take (another member's recording, filed
 * on their personal day, so its row names its owner), and the newest band
 * event gets a second rehearsal on the same day.
 *
 * "Song 2" already has three band takes (one pinned, some voted) and the
 * member's own stash recording of it.
 */
export async function dressDetailPages(band: BusyBand): Promise<DressedDetailPages> {
  const { db } = band;
  const song = await songsRepo.getBySlug(db, "song-2");
  const [instrument] = await instrumentsRepo.list(db);
  const newest = await eventsRepo.getById(db, band.bandEventIds[3] ?? "");
  if (!song || !instrument || !newest) {
    throw new Error("seedBusyBand changed shape");
  }
  await songsRepo.addAlias(db, song.id, "Píseň dva", "manual");
  await songsRepo.setInstrumentNote(db, song.id, instrument.id, "Refrén o oktávu výš.", band.now);
  const theirs = await takesRepo.create(db, {
    songId: song.id,
    eventId: band.personalEventId,
    ownerMemberId: band.personalOwnerId,
    recordedAt: newest.heldAt + 5 * HOUR,
    instrumentIds: [instrument.id],
    createdAt: newest.heldAt,
    updatedAt: newest.heldAt,
  });
  await takesRepo.setStateWithPublishedAt(db, theirs.id, "published", band.now, band.now);
  await assetsRepo.createMany(db, [
    {
      takeId: theirs.id,
      kind: "master",
      tier: "lossy",
      format: "opus",
      storageKey: `takes/${theirs.id}/master/lossy.opus`,
      contentType: "audio/opus",
      bytes: 1000,
      status: "ready",
      createdAt: band.now,
      readyAt: band.now,
    },
  ]);
  await eventsRepo.create(db, {
    kind: newest.kind,
    heldAt: newest.heldAt,
    title: "Druhá zkouška",
    createdAt: band.now,
    updatedAt: band.now,
  });
  return { songSlug: song.slug, bandEventId: newest.id };
}

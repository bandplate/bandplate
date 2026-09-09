// Song identity resolution — contract v1 §6, implemented exactly in the
// order specified there, first match wins:
//   1. `song.externalRef` matches a stored alias.
//   2. Normalized `song.title` matches a song's normalized title (and the
//      externalRef, if any, is recorded as a new alias).
//   3. Normalized `song.title` matches an existing alias.
//   4. No match, `createIfMissing: true` -> a stub song is created.
//   5. No match, `createIfMissing: false` -> not found (caller 409s with
//      fuzzy candidates).
import { allocateSongSlug, normalizeTitle } from "@bandplate/core";
import { type Db, songsRepo } from "@bandplate/db";

export type SongMatch = "external-ref" | "title" | "alias" | "created-stub";

export interface ResolveSongInput {
  externalRef?: string | null;
  title: string;
  createIfMissing: boolean;
}

export type ResolveSongResult =
  | { found: true; song: songsRepo.Song; created: boolean; match: SongMatch }
  | { found: false; candidates: songsRepo.Song[] };

/**
 * A matched song that had been archived comes back.
 *
 * Not an option and not a warning: the band has just recorded a take of it, so
 * "we don't play this any more" has stopped being true. Skipping archived
 * songs instead is not even implementable — `songs.title_norm` is UNIQUE, so
 * the create path would throw straight into the race handler and return the
 * archived row anyway, just with a wasted insert and a confusing `created`
 * flag. Un-archiving says the true thing.
 */
async function reviveIfArchived(
  db: Db,
  now: number,
  song: songsRepo.Song,
): Promise<songsRepo.Song> {
  if (song.archivedAt === null) {
    return song;
  }
  await songsRepo.update(db, song.id, { archivedAt: null, updatedAt: now });
  return { ...song, archivedAt: null };
}

/** Up to 5 loose title matches for a `song_not_found` response's `candidates`. */
async function fuzzyCandidates(db: Db, title: string): Promise<songsRepo.Song[]> {
  const results = await songsRepo.listWithStats(db, { search: title });
  return results.slice(0, 5);
}

export async function resolveSong(
  db: Db,
  now: number,
  input: ResolveSongInput,
): Promise<ResolveSongResult> {
  const externalRefNorm = input.externalRef ? normalizeTitle(input.externalRef) : undefined;

  if (externalRefNorm) {
    const byExternalRef = await songsRepo.findByAlias(db, externalRefNorm);
    if (byExternalRef) {
      return {
        found: true,
        song: await reviveIfArchived(db, now, byExternalRef),
        created: false,
        match: "external-ref",
      };
    }
  }

  const titleNorm = normalizeTitle(input.title);
  const byTitle = await songsRepo.findByTitleNorm(db, titleNorm);
  if (byTitle) {
    if (input.externalRef) {
      // Record the externalRef as a new alias so later ingests hit case 1
      // directly (contract v1 §6, case 2) — but only once: a song already
      // matched by title on a later ingest run with the SAME externalRef
      // would have already hit case 1 above, so this insert can't run
      // twice for the same (song, externalRef) pair in practice. Still
      // guard against a duplicate alias row (e.g. a title match landing on
      // a DIFFERENT song than a stale externalRef points at) by checking
      // first — `song_aliases.alias_norm` is UNIQUE across the whole
      // table, so an unguarded insert here could throw.
      const existingAlias = await songsRepo.findByAlias(db, externalRefNorm as string);
      if (!existingAlias) {
        await songsRepo.addAlias(db, byTitle.id, input.externalRef, "ingest");
      }
    }
    return {
      found: true,
      song: await reviveIfArchived(db, now, byTitle),
      created: false,
      match: "title",
    };
  }

  const byAlias = await songsRepo.findByAlias(db, titleNorm);
  if (byAlias) {
    return {
      found: true,
      song: await reviveIfArchived(db, now, byAlias),
      created: false,
      match: "alias",
    };
  }

  if (input.createIfMissing) {
    const slug = await allocateSongSlug(db, input.title);
    try {
      const song = await songsRepo.createWithAlias(
        db,
        { title: input.title, slug, isStub: true, createdAt: now, updatedAt: now },
        input.externalRef ? { value: input.externalRef, source: "ingest" } : undefined,
      );
      return { found: true, song, created: true, match: "created-stub" };
    } catch (err) {
      // Lost the race against a concurrent create for the same normalized
      // title (`songs.title_norm` is UNIQUE) — two different titles that
      // both normalize to e.g. "pritel" would otherwise both succeed and
      // permanently duplicate the song. Same idempotency-under-a-race
      // guard `events.ts`/`takes.ts` use for their clientRef UNIQUE races:
      // fall back to the winner's row rather than 500ing on what is, from
      // the caller's perspective, a retried/concurrent request.
      const winner = await songsRepo.findByTitleNorm(db, titleNorm);
      if (!winner) {
        throw err;
      }
      if (externalRefNorm) {
        const existingAlias = await songsRepo.findByAlias(db, externalRefNorm);
        if (!existingAlias) {
          // biome-ignore lint/style/noNonNullAssertion: externalRefNorm is only set when input.externalRef is
          await songsRepo.addAlias(db, winner.id, input.externalRef!, "ingest");
        }
      }
      return {
        found: true,
        song: await reviveIfArchived(db, now, winner),
        created: false,
        match: "title",
      };
    }
  }

  return { found: false, candidates: await fuzzyCandidates(db, input.title) };
}

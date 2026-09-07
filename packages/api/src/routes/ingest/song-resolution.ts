// Song identity resolution — contract v1 §6, implemented exactly in the
// order specified there, first match wins:
//   1. `song.externalRef` matches a stored alias.
//   2. Normalized `song.title` matches a song's normalized title (and the
//      externalRef, if any, is recorded as a new alias).
//   3. Normalized `song.title` matches an existing alias.
//   4. No match, `createIfMissing: true` -> a stub song is created.
//   5. No match, `createIfMissing: false` -> not found (caller 409s with
//      fuzzy candidates).
import { normalizeTitle, slugify } from "@bandlib/core";
import { type Db, songsRepo } from "@bandlib/db";

export type SongMatch = "external-ref" | "title" | "alias" | "created-stub";

export interface ResolveSongInput {
  externalRef?: string | null;
  title: string;
  createIfMissing: boolean;
}

export type ResolveSongResult =
  | { found: true; song: songsRepo.Song; created: boolean; match: SongMatch }
  | { found: false; candidates: songsRepo.Song[] };

async function uniqueSongSlug(db: Db, title: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  let suffix = 2;
  // Bounded by construction (999 attempts) rather than unbounded — a
  // collision streak this long would mean something else is wrong (e.g.
  // the same title being stubbed out concurrently in a tight loop), and an
  // infinite loop here would hang the request instead of surfacing that.
  while ((await songsRepo.getBySlug(db, candidate)) !== undefined && suffix < 1000) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
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
      return { found: true, song: byExternalRef, created: false, match: "external-ref" };
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
    return { found: true, song: byTitle, created: false, match: "title" };
  }

  const byAlias = await songsRepo.findByAlias(db, titleNorm);
  if (byAlias) {
    return { found: true, song: byAlias, created: false, match: "alias" };
  }

  if (input.createIfMissing) {
    const slug = await uniqueSongSlug(db, input.title);
    const song = await songsRepo.createWithAlias(
      db,
      { title: input.title, slug, isStub: true, createdAt: now, updatedAt: now },
      input.externalRef ? { value: input.externalRef, source: "ingest" } : undefined,
    );
    return { found: true, song, created: true, match: "created-stub" };
  }

  return { found: false, candidates: await fuzzyCandidates(db, input.title) };
}

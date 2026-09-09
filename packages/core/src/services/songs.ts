import { type Db, songsRepo } from "@bandplate/db";
// Song identity helpers shared by both front doors.
//
// Slug allocation moved here out of the ingest routes because "Add song" in
// the browser needs the identical collision walk. A second implementation
// would drift, and the failure it drifts into is silent: two songs with the
// same slug is a UNIQUE violation the member sees as a 500, and a slug walk
// that gives up differently produces URLs that depend on which door the song
// came through.
import { slugify } from "../text.js";

/**
 * Find a free slug for a title: `slugify(title)`, then `-2`, `-3`, … until
 * one is unused.
 *
 * Bounded at 999 attempts by construction rather than looping until success —
 * a collision streak that long means something else is wrong (the same title
 * being created concurrently in a tight loop, say), and an unbounded loop
 * would hang the request instead of surfacing it.
 *
 * Racy by nature: two callers can be handed the same free slug before either
 * inserts. That is deliberate and safe — `songs.slug` is UNIQUE, so the loser
 * gets a constraint error its caller already handles by re-reading the winner
 * (`resolveSong`'s race fallback, and the same guard the manual create path
 * uses). Holding a lock instead would need a transaction, which D1 does not
 * have.
 */
export async function allocateSongSlug(db: Db, title: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  let suffix = 2;
  while ((await songsRepo.getBySlug(db, candidate)) !== undefined && suffix < 1000) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

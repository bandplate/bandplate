import { type SQL, and, eq } from "drizzle-orm";
import { takes } from "../schema/sqlite/index.js";

/**
 * Which takes a query may return, decided in one place.
 *
 * A private take is one member's stash recording, and nobody else may learn
 * it exists: not as a row, a count, a search hit, or a song's last-played
 * date. There are exactly two ways a query may see takes, and every listing,
 * count and aggregate uses one of these two conditions rather than spelling
 * the rule out again. A copy that forgets it leaks a stash, which is why this
 * module exists and why `stash-privacy.test.ts` calls every read that touches
 * the `takes` table.
 *
 * There is deliberately no "band takes plus my own private ones" condition:
 * no view mixes the two. A member sees their stash through the stash views and
 * the band's takes everywhere else. Resolving ONE take by id is a different
 * question, answered in JS by `takesRepo.isVisibleTo`.
 */

/**
 * The takes the whole band can see. The floor under every band view: a
 * private take never appears in a listing, a count or a search, not even for
 * its owner, who sees it in the stash views instead.
 */
export function bandTakeCondition(): SQL {
  return eq(takes.visibility, "band");
}

/** The takes in one member's stash: private, and theirs. */
export function stashTakeCondition(memberId: string): SQL {
  // `and()` returns `undefined` only for an empty argument list.
  return and(eq(takes.ownerMemberId, memberId), eq(takes.visibility, "private")) as SQL;
}

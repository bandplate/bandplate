// `/me` — the signed-in member's own page: name, instruments, sessions
// (with the ability to sign out of the current one — reusing the existing
// `POST /logout`, not a new endpoint), favorites, and votes so far.
//
// Instruments (Task 6 review round 1's "data-model gap"): closed via the
// `memberInstruments` join table — see its schema comment for why a join
// table rather than a JSON column. `membersRepo.listInstrumentsForMember`
// includes archived instruments on purpose, so a member who plays one the
// band has since dropped still sees it here.
import { hashToken } from "@bandplate/core";
import type { Db, instrumentsRepo } from "@bandplate/db";
import { authSessionsRepo, membersRepo, takesRepo, votesRepo } from "@bandplate/db";
import { type HomeFavorites, getFavorites } from "./home.js";
import { type TakeWithFullContext, attachFullContext } from "./take-context.js";

export interface SessionWithCurrent extends authSessionsRepo.Session {
  isCurrent: boolean;
}

export interface VoteWithTake {
  vote: votesRepo.Vote;
  take: TakeWithFullContext | undefined;
  /**
   * Whether `take` is ALSO one of this member's favorites — independent of
   * having voted on it, so it's real information (Task 6 review round 1's
   * F4: a decorative star next to a heading that already says "Favorites"
   * carries none). See `TakeRow`'s own `favorited` prop for the rest of
   * this marker's use on `/`, `/search`, and `/takes/[id]`.
   */
  favorited: boolean;
}

export interface MeData {
  member: membersRepo.Member;
  instruments: instrumentsRepo.Instrument[];
  sessions: SessionWithCurrent[];
  favorites: HomeFavorites;
  votes: VoteWithTake[];
  /**
   * How many published takes this member has never voted on. Home used to
   * render these as a "needs your vote" queue; nothing on the page everyone
   * opens should nag, so what is left is a count HERE — on the page you visit
   * to see your own state, where it is something you went looking for rather
   * than something shoved at you. A number, not a list: the list was six rows
   * of the same take row that made home long.
   */
  unvotedCount: number;
}

/**
 * Which of the member's sessions the current request is using — resolved
 * from the raw session cookie (not carried on `Principal`, which only
 * knows `memberId`/`role`/`scopes`), so `/me` can mark it and offer
 * "sign out of this session" next to that one row only.
 */
async function resolveCurrentSessionId(
  db: Db,
  cookieValue: string | undefined,
): Promise<string | undefined> {
  if (!cookieValue) {
    return undefined;
  }
  const tokenHash = await hashToken(cookieValue);
  const session = await authSessionsRepo.getByHash(db, tokenHash);
  return session?.id;
}

async function getVotes(
  db: Db,
  memberId: string,
): Promise<Array<{ vote: votesRepo.Vote; take: TakeWithFullContext | undefined }>> {
  const votes = await votesRepo.listByMember(db, memberId);
  const takeIds = votes.map((v) => v.takeId);
  const takes = await takesRepo.getByIds(db, takeIds);
  const withContext = await attachFullContext(db, takes, memberId);
  const byTakeId = new Map(withContext.map((t) => [t.id, t]));
  return votes.map((vote) => ({ vote, take: byTakeId.get(vote.takeId) }));
}

export async function getMeData(
  db: Db,
  memberId: string,
  sessionCookieValue: string | undefined,
): Promise<MeData | undefined> {
  const member = await membersRepo.getById(db, memberId);
  if (!member) {
    return undefined;
  }

  const [instruments, sessions, currentSessionId, favorites, votes, unvoted] = await Promise.all([
    membersRepo.listInstrumentsForMember(db, memberId),
    authSessionsRepo.listByMember(db, memberId),
    resolveCurrentSessionId(db, sessionCookieValue),
    getFavorites(db, memberId),
    getVotes(db, memberId),
    takesRepo.listUnvotedByMember(db, memberId),
  ]);

  // No extra query — `favorites.takes` (already fetched above) is this
  // member's complete favorited-take set.
  const favoriteTakeIds = new Set(favorites.takes.map((t) => t.id));

  return {
    member,
    instruments,
    sessions: sessions.map((s) => ({ ...s, isCurrent: s.id === currentSessionId })),
    favorites,
    votes: votes.map((v) => ({ ...v, favorited: v.take ? favoriteTakeIds.has(v.take.id) : false })),
    unvotedCount: unvoted.length,
  };
}

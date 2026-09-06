// `/me` — the signed-in member's own page: name, sessions (with the
// ability to sign out of the current one — reusing the existing
// `POST /logout`, not a new endpoint), favorites, and votes so far.
//
// No "their instruments" field: the brief lists one, but there is no
// member<->instrument relation anywhere in the schema (`packages/db/src/schema/sqlite/index.ts`
// has no join table for it, and nothing in the seed associates a member
// with an instrument) — a real gap between the brief and the data model
// this task inherited, not something to invent a migration for here. See
// task-6-report.md's deviations section.
import { hashToken } from "@bandlib/core";
import type { Db } from "@bandlib/db";
import { authSessionsRepo, membersRepo, takesRepo, votesRepo } from "@bandlib/db";
import { type HomeFavorites, getFavorites } from "./home.js";
import { type TakeWithFullContext, attachFullContext } from "./take-context.js";

export interface SessionWithCurrent extends authSessionsRepo.Session {
  isCurrent: boolean;
}

export interface VoteWithTake {
  vote: votesRepo.Vote;
  take: TakeWithFullContext | undefined;
}

export interface MeData {
  member: membersRepo.Member;
  sessions: SessionWithCurrent[];
  favorites: HomeFavorites;
  votes: VoteWithTake[];
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

async function getVotes(db: Db, memberId: string): Promise<VoteWithTake[]> {
  const votes = await votesRepo.listByMember(db, memberId);
  const takeIds = votes.map((v) => v.takeId);
  const takes = await takesRepo.getByIds(db, takeIds);
  const withContext = await attachFullContext(db, takes);
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

  const [sessions, currentSessionId, favorites, votes] = await Promise.all([
    authSessionsRepo.listByMember(db, memberId),
    resolveCurrentSessionId(db, sessionCookieValue),
    getFavorites(db, memberId),
    getVotes(db, memberId),
  ]);

  return {
    member,
    sessions: sessions.map((s) => ({ ...s, isCurrent: s.id === currentSessionId })),
    favorites,
    votes,
  };
}

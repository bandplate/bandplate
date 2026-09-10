// `/me` — the signed-in member's own page: who they are, and what they have
// done. Not a shelf: home already IS the shelf of exactly the things this page
// used to list again under Songs / Events / Takes, and rendering the same rows
// on two pages is what made both of them long.
//
// The device/session list is gone too. It showed raw user-agent strings and a
// status badge to answer a question no member in a five-piece band asks, and
// signing out lives in the shell where it is always reachable. The one thing it
// could do that nothing else can is revoke a session on a device you no longer
// hold — deliberately traded away; recovery is a DB operation, as it already is
// for everything else about a member's credentials.
//
// Instruments (Task 6 review round 1's "data-model gap"): closed via the
// `memberInstruments` join table — see its schema comment for why a join
// table rather than a JSON column. `membersRepo.listInstrumentsForMember`
// includes archived instruments on purpose, so a member who plays one the
// band has since dropped still sees it here.
import type { Db, PageArgs, instrumentsRepo } from "@bandplate/db";
import { membersRepo, takesRepo, votesRepo } from "@bandplate/db";
import { type TakeWithFullContext, attachFullContext } from "./take-context.js";

export interface VoteWithTake {
  vote: votesRepo.Vote;
  take: TakeWithFullContext | undefined;
}

export interface MeData {
  member: membersRepo.Member;
  instruments: instrumentsRepo.Instrument[];
  /** ONE PAGE of votes, most recently changed first. */
  votes: VoteWithTake[];
  /** How many votes this member has cast in all. */
  voteTotal: number;
  /**
   * How many published takes this member has never voted on. Home used to
   * render these as a queue; nothing on the page everyone opens should nag, so
   * what is left is a count here — on the page you visit to see your own state,
   * where it is something you went looking for. A number, not a list.
   */
  unvotedCount: number;
}

/**
 * Rows per page in the vote history.
 *
 * This is the listing that grows most reliably: one row per take a member has
 * ever judged, forever, with nothing that ever removes one.
 */
export const VOTES_PER_PAGE = 20;

async function getVotes(
  db: Db,
  memberId: string,
  page: PageArgs,
): Promise<{ votes: VoteWithTake[]; total: number }> {
  const { rows: voteRows, total } = await votesRepo.listByMember(db, memberId, { page });
  const votes = voteRows;
  const takeIds = votes.map((v) => v.takeId);
  const takes = await takesRepo.getByIds(db, takeIds);
  const withContext = await attachFullContext(db, takes, memberId);
  const byTakeId = new Map(withContext.map((t) => [t.id, t]));
  return { votes: votes.map((vote) => ({ vote, take: byTakeId.get(vote.takeId) })), total };
}

export async function getMeData(
  db: Db,
  memberId: string,
  votesPage: PageArgs = { limit: VOTES_PER_PAGE, offset: 0 },
): Promise<MeData | undefined> {
  const member = await membersRepo.getById(db, memberId);
  if (!member) {
    return undefined;
  }

  const [instruments, votes, unvoted] = await Promise.all([
    membersRepo.listInstrumentsForMember(db, memberId),
    getVotes(db, memberId, votesPage),
    takesRepo.listUnvotedByMember(db, memberId),
  ]);

  return {
    member,
    instruments,
    votes: votes.votes,
    voteTotal: votes.total,
    unvotedCount: unvoted.length,
  };
}

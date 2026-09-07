// Pure decision logic for `VoteFavorite.tsx`'s optimistic update — kept
// separate from the DOM/fetch side effects the same way
// `player-actions.ts#decidePlayerClickAction` is, so the arithmetic itself
// is unit-testable without mounting a component or mocking `fetch`.
//
// `computeOptimisticTally` mirrors `votesRepo.buildAggregateUpdate`'s SQL
// (COUNT/SUM-over-keeper, COALESCEd for the zero-vote case) in plain JS —
// NOT by calling the server, since the whole point of "optimistic" is
// showing the new tally before the server has responded. It has to stay
// correct for the same three cases `castVote`'s own tests cover: a fresh
// vote, a changed vote, and a no-op re-vote (the same value twice, which
// the segmented `VoteToggle` UI shouldn't normally submit, but a
// double-click/double-submit race can still produce).
export interface Tally {
  keeperVotes: number;
  totalVotes: number;
  ratingScore: number;
}

export function computeOptimisticTally(
  current: Tally,
  previousVote: boolean | undefined,
  nextVote: boolean,
): Tally {
  let keeperVotes = current.keeperVotes;
  let totalVotes = current.totalVotes;

  if (previousVote === undefined) {
    totalVotes += 1;
    if (nextVote) {
      keeperVotes += 1;
    }
  } else if (previousVote !== nextVote) {
    keeperVotes += nextVote ? 1 : -1;
  }
  // previousVote === nextVote: no change — a same-value resubmit is a no-op.

  const ratingScore = totalVotes > 0 ? keeperVotes / totalVotes : 0;
  return { keeperVotes, totalVotes, ratingScore };
}

/**
 * The tally sentence — deliberately duplicated from, not imported from,
 * `server/format.ts#formatVoteTally`. Every other client-bundled module in
 * this app (`client/`, and the islands in `components/`) only ever imports
 * from `client/` or `@bandlib/*` packages, never from `server/` — nothing
 * in `server/` is audited for being safe to ship to the browser (some of
 * it touches `Db`/session cookies directly), and importing across that
 * boundary once would make it easy to do again for something that isn't
 * safe. Four lines of formatting logic, covered by this module's own test
 * file, is cheaper than being the first crack in that boundary.
 */
export function formatVoteTallyClient(
  keeperVotes: number,
  totalVotes: number,
  ratingScore: number,
): string {
  if (totalVotes === 0) {
    return "No votes yet.";
  }
  return `${keeperVotes} of ${totalVotes} ${totalVotes === 1 ? "vote says" : "votes say"} keeper (${Math.round(ratingScore * 100)}%).`;
}

/**
 * Markup `VoteFavorite.tsx#removeFromUnvotedList` swaps in for
 * `[data-unvoted-list]` once removing a voted-on row leaves it empty —
 * deliberately duplicated from, not read out of, `index.astro`'s own
 * `unvotedTakes.length === 0` branch, same reasoning as
 * `formatVoteTallyClient` above (a client-bundled module never imports
 * `server/`-side rendering, and this module's own test file is what keeps
 * the duplicate honest).
 *
 * Voting the LAST "needs your vote" take used to leave a bare `<h2>` over
 * an empty `[data-unvoted-list]` — the blank panel the brief's §3
 * explicitly forbids, correct only after a reload. This is the fix: match
 * the server's empty state exactly instead of leaving nothing behind.
 */
export const UNVOTED_LIST_EMPTY_STATE_HTML =
  "<p><strong>You're all caught up.</strong> Every published take has your vote — check back once the band records something new.</p>";

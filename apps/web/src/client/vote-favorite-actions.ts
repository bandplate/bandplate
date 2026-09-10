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
import { votingMessages } from "@bandplate/i18n";
import { currentLocale } from "./locale.js";
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
 * The tally sentence.
 *
 * This used to be a deliberate, hand-maintained COPY of
 * `server/format.ts#formatVoteTally`, kept honest by a test asserting the two
 * were byte-identical. The reason was a real boundary: a client-bundled module
 * must never import from `server/`, none of which is audited for being safe to
 * ship to a browser. Duplicating four lines was cheaper than cracking that.
 *
 * With two languages it stops being four lines and starts being four
 * SENTENCES, and Czech agrees its verb with the count. So the sentence moved
 * where both sides can reach it: `@bandplate/i18n` is a zero-dependency
 * package, which `client/` has always been allowed to import. The boundary is
 * intact and there is no longer anything to keep in step.
 *
 * The signature is unchanged so nothing calling it had to move.
 */
export function formatVoteTallyClient(
  keeperVotes: number,
  totalVotes: number,
  ratingScore: number,
): string {
  return votingMessages(currentLocale()).tally({ keeperVotes, totalVotes, ratingScore });
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

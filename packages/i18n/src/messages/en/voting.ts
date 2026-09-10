// What the app says about votes, in English.
//
// --- How a catalog area is shaped -----------------------------------------
//
// Entries are plain strings unless they interpolate or pluralise, in which
// case they are FUNCTIONS. A function is the only shape a translator can
// restructure: Czech reorders the clauses of this very sentence and agrees its
// verb with the count, and no `"{n} of {total} votes say keeper"` template
// string can express that.
//
// Any function taking more than one value takes a single named object, never
// positional arguments — a proofreader must not have to count commas to work
// out which number is which.
//
// English is the SHAPE every other language is checked against: `Messages` is
// `typeof en`, so a missing key, an extra key, or a function with the wrong
// arity in `cs` is a `pnpm typecheck` failure rather than something a reader
// discovers.
import { plural } from "../../plural.js";

export interface VoteTally {
  keeperVotes: number;
  totalVotes: number;
  /** 0..1. Rendered as a percentage. */
  ratingScore: number;
}

export const voting = {
  /**
   * The vote-tally sentence.
   *
   * Empty, not "No votes yet." — an unvoted take is the common case in any
   * list, so that sentence appeared under nearly every row and said nothing a
   * reader needed. The element stays in the DOM and `.bp-vote-tally:empty`
   * hides it, so the optimistic island can fill it the moment a vote lands
   * without needing to unhide anything.
   */
  tally: ({ keeperVotes, totalVotes, ratingScore }: VoteTally): string => {
    if (totalVotes === 0) {
      return "";
    }
    const says = plural("en", totalVotes, { one: "vote says", other: "votes say" });
    return `${keeperVotes} of ${totalVotes} ${says} keeper (${Math.round(ratingScore * 100)}%).`;
  },

  /** The two-position toggle, and the group it lives in. */
  groupLabel: "Your vote",
  keeper: "Keeper",
  notKeeper: "Not a keeper",

  /** When the optimistic update had to be rolled back. */
  saveFailed: "Couldn't save your vote. Try again.",
};

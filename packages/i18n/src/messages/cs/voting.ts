// Co aplikace říká o hlasování.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ Every line carries the English it replaces as a trailing comment, so    │
// │ this file is the review surface: read the Czech, compare, and EDIT IT   │
// │ HERE — the edit is the fix, there is no other copy to keep in step.     │
// │                                                                        │
// │ Register is INFORMAL (tykání), because the English is: plain, warm and  │
// │ contraction-heavy. Czech software translation drifts into passive       │
// │ officialese ("Váš hlas se nepodařilo uložit") — that is the one thing   │
// │ to push back on.                                                       │
// │                                                                        │
// │ GLOSSARY IN USE HERE — overrule freely, it is one pass:                 │
// │   keeper / not a keeper → držák / odpad          [SETTLED by the owner] │
// │       A verdict, not a noun, and band slang rather than a translation.  │
// │       "beru / neberu" was the working default and was overruled.        │
// │   vote → hlas / hlasy / hlasů                                           │
// └────────────────────────────────────────────────────────────────────────┘
import { formatNumber, plural } from "../../plural.js";
import type { voting as enVoting, VoteTally } from "../en/voting.js";

export const voting = {
  tally: ({ keeperVotes, totalVotes, ratingScore }: VoteTally): string => {
    // en: `${k} of ${t} ${t === 1 ? "vote says" : "votes say"} keeper (${pct}%).`
    //
    // Restructured rather than translated word for word, which is the whole
    // reason catalog entries are functions.
    //
    // The literal shape — "3 z 5 hlasů říká beru" — drags a verb that has to
    // agree with the count into the middle of a phrase whose noun is already
    // governed by "z" (genitive). Fronting the verdict drops the verb
    // entirely and leaves one clean agreement to get right:
    //
    //     z 1 hlasu   (genitive SINGULAR, only for 1)
    //     z 5 hlasů   (genitive plural — 0, 2, 3, 4, 5, everything else)
    //
    // Note that unlike a bare count, 2–4 does NOT take `few` here: after "z"
    // every plural is genitive, so `few` and `other` are the same word. That
    // is exactly the kind of thing a per-noun form record can express and a
    // singular/plural pair cannot.
    //
    // "%" takes a non-breaking space before it in Czech typography, unlike
    // English, where it is set tight.
    if (totalVotes === 0) {
      return "";
    }
    const votes = plural("cs", totalVotes, {
      one: "hlasu",
      few: "hlasů",
      many: "hlasu",
      other: "hlasů",
    });
    const k = formatNumber("cs", keeperVotes);
    const t = formatNumber("cs", totalVotes);
    const percent = formatNumber("cs", Math.round(ratingScore * 100));
    return `Držák: ${k} z ${t} ${votes} (${percent} %).`;
  },

  groupLabel: "Tvůj hlas", // en: Your vote
  keeper: "Držák", // en: Keeper
  notKeeper: "Odpad", // en: Not a keeper

  saveFailed: "Hlas se neuložil. Zkus to znovu.", // en: Couldn't save your vote. Try again.

  favoriteAdd: (name: string): string => `Přidat ${name} do oblíbených`, // en: `Add ${name} to favorites`
  favoriteRemove: (name: string): string => `Odebrat ${name} z oblíbených`, // en: `Remove ${name} from favorites`
  // en: Couldn't update your favorites. Try again.
  favoriteFailed: "Oblíbené se neuložily. Zkus to znovu.",
} satisfies typeof enVoting;

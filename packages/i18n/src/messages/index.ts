// The whole catalog, composed — what a SERVER render uses.
//
// A page has one locale for the whole document and renders every area of it,
// so it takes the lot in one lookup: `const t = messages(locale)`, then
// `t.voting.keeper`. Islands do NOT import this; they import their own area
// module (`messages/voting.js` and friends) so the client bundle carries only
// the copy that island actually says. See `messages/voting.ts` for why.
//
// Areas are added here as they are extracted, one commit per area, so this
// list doubles as the record of how far the translation has got.
import type { Locale } from "../locale.js";
import { authByLocale } from "./auth.js";
import { commonByLocale } from "./common.js";
import { eventsByLocale } from "./events.js";
import { homeByLocale } from "./home.js";
import { meByLocale } from "./me.js";
import { playerByLocale } from "./player.js";
import { shellByLocale } from "./shell.js";
import { songsByLocale } from "./songs.js";
import { takesByLocale } from "./takes.js";
import { votingByLocale } from "./voting.js";

const CATALOG = {
  en: {
    auth: authByLocale.en,
    common: commonByLocale.en,
    events: eventsByLocale.en,
    home: homeByLocale.en,
    me: meByLocale.en,
    player: playerByLocale.en,
    shell: shellByLocale.en,
    songs: songsByLocale.en,
    takes: takesByLocale.en,
    voting: votingByLocale.en,
  },
  cs: {
    auth: authByLocale.cs,
    common: commonByLocale.cs,
    events: eventsByLocale.cs,
    home: homeByLocale.cs,
    me: meByLocale.cs,
    player: playerByLocale.cs,
    shell: shellByLocale.cs,
    songs: songsByLocale.cs,
    takes: takesByLocale.cs,
    voting: votingByLocale.cs,
  },
} as const;

/**
 * The English catalog is the SHAPE. Every other language is declared
 * `satisfies` its English counterpart area by area, so a missing key, an extra
 * key, or a function whose arity has drifted is a typecheck failure rather
 * than a blank on a page.
 */
export type Messages = (typeof CATALOG)["en"];

export function messages(locale: Locale): Messages {
  return CATALOG[locale];
}

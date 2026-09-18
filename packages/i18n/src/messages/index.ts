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
import { adminByLocale } from "./admin.js";
import { authByLocale } from "./auth.js";
import { commonByLocale } from "./common.js";
import { eventsByLocale } from "./events.js";
import { homeByLocale } from "./home.js";
import { islandsByLocale } from "./islands.js";
import { mailByLocale } from "./mail.js";
import { meByLocale } from "./me.js";
import { mixerByLocale } from "./mixer.js";
import { playerByLocale } from "./player.js";
import { pushByLocale } from "./push.js";
import { shellByLocale } from "./shell.js";
import { songsByLocale } from "./songs.js";
import { takesByLocale } from "./takes.js";
import { validationByLocale } from "./validation.js";
import { votingByLocale } from "./voting.js";

const CATALOG = {
  en: {
    admin: adminByLocale.en,
    auth: authByLocale.en,
    common: commonByLocale.en,
    events: eventsByLocale.en,
    home: homeByLocale.en,
    islands: islandsByLocale.en,
    mail: mailByLocale.en,
    me: meByLocale.en,
    mixer: mixerByLocale.en,
    player: playerByLocale.en,
    push: pushByLocale.en,
    shell: shellByLocale.en,
    songs: songsByLocale.en,
    takes: takesByLocale.en,
    validation: validationByLocale.en,
    voting: votingByLocale.en,
  },
  cs: {
    admin: adminByLocale.cs,
    auth: authByLocale.cs,
    common: commonByLocale.cs,
    events: eventsByLocale.cs,
    home: homeByLocale.cs,
    islands: islandsByLocale.cs,
    mail: mailByLocale.cs,
    me: meByLocale.cs,
    mixer: mixerByLocale.cs,
    player: playerByLocale.cs,
    push: pushByLocale.cs,
    shell: shellByLocale.cs,
    songs: songsByLocale.cs,
    takes: takesByLocale.cs,
    validation: validationByLocale.cs,
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

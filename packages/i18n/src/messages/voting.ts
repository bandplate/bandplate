// The `voting` area, both languages, on its own import path.
//
// Areas are separate modules rather than one big catalog because of the
// CLIENT bundle. `Player` and `VoteFavorite` mount on every page
// (`AppLayout.astro`'s `client:load`), while `ChartEditor` and `AssetUploader`
// mount only on a song or take detail — a single `messages.ts` would ship the
// chart editor's copy to every page in the app. An island imports the one area
// it speaks, and gets both languages of it and nothing else.
//
// Both languages, because the choice is made at runtime from
// `document.documentElement.lang`: a bundler cannot tree-shake a dynamic
// lookup, and pretending otherwise would just mean shipping a broken switch.
// The areas are small enough that this is the cheaper end of the trade.
import type { Locale } from "../locale.js";
import { voting as cs } from "./cs/voting.js";
import { voting as en } from "./en/voting.js";

export type { VoteTally } from "./en/voting.js";

/**
 * `Record<Locale, …>`, never `Record<string, …>` — `noUncheckedIndexedAccess`
 * is on, and a finite union key is what keeps the lookup from being
 * `… | undefined` at every call site.
 */
export const votingByLocale: Record<Locale, typeof en> = { en, cs };

export function votingMessages(locale: Locale): typeof en {
  return votingByLocale[locale];
}

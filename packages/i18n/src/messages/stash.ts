// The `stash` area, both languages. See `messages/voting.ts` for why areas are
// separate modules.
import type { Locale } from "../locale.js";
import { stash as cs } from "./cs/stash.js";
import { stash as en } from "./en/stash.js";

export const stashByLocale: Record<Locale, typeof en> = { en, cs };

export function stashMessages(locale: Locale): typeof en {
  return stashByLocale[locale];
}

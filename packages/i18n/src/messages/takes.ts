// The `takes` area, both languages. See `messages/voting.ts` for why areas are
// separate modules.
import type { Locale } from "../locale.js";
import { takes as cs } from "./cs/takes.js";
import { takes as en } from "./en/takes.js";

export const takesByLocale: Record<Locale, typeof en> = { en, cs };

export function takesMessages(locale: Locale): typeof en {
  return takesByLocale[locale];
}

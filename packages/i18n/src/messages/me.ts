// The `me` area, both languages. See `messages/voting.ts` for why areas are
// separate modules.
import type { Locale } from "../locale.js";
import { me as cs } from "./cs/me.js";
import { me as en } from "./en/me.js";

export { LANGUAGE_NAMES } from "./en/me.js";

export const meByLocale: Record<Locale, typeof en> = { en, cs };

export function meMessages(locale: Locale): typeof en {
  return meByLocale[locale];
}

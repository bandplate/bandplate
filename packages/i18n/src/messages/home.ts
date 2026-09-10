// The `home` area, both languages. See `messages/voting.ts` for why areas are
// separate modules.
import type { Locale } from "../locale.js";
import { home as cs } from "./cs/home.js";
import { home as en } from "./en/home.js";

export const homeByLocale: Record<Locale, typeof en> = { en, cs };

export function homeMessages(locale: Locale): typeof en {
  return homeByLocale[locale];
}

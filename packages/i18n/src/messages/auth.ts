// The `auth` area, both languages. See `messages/voting.ts` for why areas are
// separate modules.
import type { Locale } from "../locale.js";
import { auth as cs } from "./cs/auth.js";
import { auth as en } from "./en/auth.js";

export const authByLocale: Record<Locale, typeof en> = { en, cs };

export function authMessages(locale: Locale): typeof en {
  return authByLocale[locale];
}

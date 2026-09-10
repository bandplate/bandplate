// The `mail` area, both languages. See `messages/voting.ts` for why areas are
// separate modules — this one never reaches the browser at all.
import type { Locale } from "../locale.js";
import { mail as cs } from "./cs/mail.js";
import { mail as en } from "./en/mail.js";

export const mailByLocale: Record<Locale, typeof en> = { en, cs };

export function mailMessages(locale: Locale): typeof en {
  return mailByLocale[locale];
}

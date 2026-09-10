// The `admin` area, both languages. See `messages/voting.ts` for why areas are
// separate modules — nothing here ever reaches a page a plain member can open.
import type { Locale } from "../locale.js";
import { admin as cs } from "./cs/admin.js";
import { admin as en } from "./en/admin.js";

export const adminByLocale: Record<Locale, typeof en> = { en, cs };

export function adminMessages(locale: Locale): typeof en {
  return adminByLocale[locale];
}

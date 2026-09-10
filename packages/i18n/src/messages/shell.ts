// The `shell` area, both languages. See `messages/voting.ts` for why areas are
// separate modules.
import type { Locale } from "../locale.js";
import { shell as cs } from "./cs/shell.js";
import { shell as en } from "./en/shell.js";

export const shellByLocale: Record<Locale, typeof en> = { en, cs };

export function shellMessages(locale: Locale): typeof en {
  return shellByLocale[locale];
}

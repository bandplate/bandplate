// The `songs` area, both languages. See `messages/voting.ts` for why areas are
// separate modules.
import type { Locale } from "../locale.js";
import { songs as cs } from "./cs/songs.js";
import { songs as en } from "./en/songs.js";

export const songsByLocale: Record<Locale, typeof en> = { en, cs };

export function songsMessages(locale: Locale): typeof en {
  return songsByLocale[locale];
}

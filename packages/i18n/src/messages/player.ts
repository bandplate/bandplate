// The `player` area, both languages. See `messages/voting.ts` for why areas
// are separate modules — this one is loaded on every page, so it stays small.
import type { Locale } from "../locale.js";
import { player as cs } from "./cs/player.js";
import { player as en } from "./en/player.js";

export const playerByLocale: Record<Locale, typeof en> = { en, cs };

export function playerMessages(locale: Locale): typeof en {
  return playerByLocale[locale];
}

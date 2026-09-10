// The `islands` area, both languages — the chart editor, the uploader and the
// confirm dialog. See `messages/voting.ts` for why areas are separate modules,
// and `en/islands.ts` for why these three share one.
import type { Locale } from "../locale.js";
import { islands as cs } from "./cs/islands.js";
import { islands as en } from "./en/islands.js";

export const islandsByLocale: Record<Locale, typeof en> = { en, cs };

export function islandsMessages(locale: Locale): typeof en {
  return islandsByLocale[locale];
}

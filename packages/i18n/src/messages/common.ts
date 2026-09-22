// The `common` area, both languages. See `messages/voting.ts` for why areas
// are separate modules.
import type { Locale } from "../locale.js";
import { common as cs } from "./cs/common.js";
import { common as en } from "./en/common.js";

export const commonByLocale: Record<Locale, typeof en> = { en, cs };

export type { ListNoun } from "./en/common.js";

export function commonMessages(locale: Locale): typeof en {
  return commonByLocale[locale];
}

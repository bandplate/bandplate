// The mixer island's own area — imported by `Mixer.tsx` alone, never through
// the barrel. See `voting.ts` for why an island reads one area rather than
// the whole catalog.
import type { Locale } from "../locale.js";
import { mixer as cs } from "./cs/mixer.js";
import { mixer as en } from "./en/mixer.js";

export const mixerByLocale: Record<Locale, typeof en> = { en, cs };

export function mixerMessages(locale: Locale): typeof en {
  return mixerByLocale[locale];
}

// The `events` area, both languages. See `messages/voting.ts` for why areas are
// separate modules.
import type { Locale } from "../locale.js";
import { events as cs } from "./cs/events.js";
import { events as en } from "./en/events.js";

export const eventsByLocale: Record<Locale, typeof en> = { en, cs };

export function eventsMessages(locale: Locale): typeof en {
  return eventsByLocale[locale];
}

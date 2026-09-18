// The `push` area, both languages. Server-only, like `mail` — a push payload
// is built and sent from the tick, never rendered by an island. See
// `messages/mail.ts` for the identical split.
import type { Locale } from "../locale.js";
import { push as cs } from "./cs/push.js";
import { push as en } from "./en/push.js";

export const pushByLocale: Record<Locale, typeof en> = { en, cs };

export function pushMessages(locale: Locale): typeof en {
  return pushByLocale[locale];
}

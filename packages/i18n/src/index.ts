// @bandplate/i18n — what the app says, and how it says numbers and dates.
//
// Zero dependencies, on purpose: see `locale.ts`'s header for why that is
// load-bearing rather than incidental.
export {
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
  intlTag,
  isLocale,
  negotiateLocale,
} from "./locale.js";

export { type PluralForms, countOf, formatNumber, plural } from "./plural.js";

export {
  EMPTY_VALUE,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatLongDate,
  formatMonthShort,
  formatShortDate,
} from "./format.js";

export { adminMessages } from "./messages/admin.js";
export { authMessages } from "./messages/auth.js";
export { commonMessages } from "./messages/common.js";
export { eventsMessages } from "./messages/events.js";
export { homeMessages } from "./messages/home.js";
export { islandsMessages } from "./messages/islands.js";
export { mailMessages } from "./messages/mail.js";
export { type Messages, messages } from "./messages/index.js";
export { playerMessages } from "./messages/player.js";
export { LANGUAGE_NAMES, meMessages } from "./messages/me.js";
export { shellMessages } from "./messages/shell.js";
export { songsMessages } from "./messages/songs.js";
export { takesMessages } from "./messages/takes.js";
export {
  type ValidationKey,
  validationByLocale,
  validationMessage,
} from "./messages/validation.js";
export { type VoteTally, votingMessages } from "./messages/voting.js";

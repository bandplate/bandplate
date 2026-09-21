// @bandplate/i18n — what the app says, and how it says numbers and dates.
//
// Zero dependencies, on purpose: see `locale.ts`'s header for why that is
// load-bearing rather than incidental.

export {
  EMPTY_VALUE,
  formatBytes,
  formatDateTime,
  formatDayMonth,
  formatDuration,
  formatLongDate,
  formatMonthShort,
  formatShortDate,
} from "./format.js";
export {
  DEFAULT_LOCALE,
  intlTag,
  isLocale,
  LOCALES,
  type Locale,
  negotiateLocale,
} from "./locale.js";
export { adminMessages } from "./messages/admin.js";
export { authMessages } from "./messages/auth.js";
export { commonMessages } from "./messages/common.js";
export { eventsMessages } from "./messages/events.js";
export { homeMessages } from "./messages/home.js";
export { type Messages, messages } from "./messages/index.js";
export { islandsMessages } from "./messages/islands.js";
export { mailMessages } from "./messages/mail.js";
export { LANGUAGE_NAMES, meMessages } from "./messages/me.js";
export { mixerMessages } from "./messages/mixer.js";
export { playerMessages } from "./messages/player.js";
export { pushMessages } from "./messages/push.js";
export { shellMessages } from "./messages/shell.js";
export { songsMessages } from "./messages/songs.js";
export { stashMessages } from "./messages/stash.js";
export { takesMessages } from "./messages/takes.js";
export {
  type ValidationKey,
  validationByLocale,
  validationMessage,
} from "./messages/validation.js";
export { type VoteTally, votingMessages } from "./messages/voting.js";
export { countOf, formatNumber, type PluralForms, plural } from "./plural.js";

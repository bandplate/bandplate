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
  formatDuration,
  formatLongDate,
  formatMonthShort,
  formatShortDate,
} from "./format.js";

export { type Messages, messages } from "./messages/index.js";
export { type VoteTally, votingMessages } from "./messages/voting.js";

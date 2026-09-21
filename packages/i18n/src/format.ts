// Dates, durations and sizes, in the reader's language.
//
// These lived in `apps/web/src/server/format.ts` as module-level `Intl`
// singletons pinned to three different hardcoded locales — `en-CA` for admin
// timestamps, `en-US` for the two member-facing dates, `en-GB` for the event
// ledger's month. A singleton cannot take a locale, so they move here and are
// cached per locale instead.
//
// --- A latent timezone bug this did NOT fix -------------------------------
//
// None of the formatters below sets `timeZone`, exactly as none of the
// originals did, so they all render in the HOST's zone. Under the Node adapter
// that is the deployer's; inside a Worker it is always UTC. An event held at
// 23:00 in Prague therefore ALREADY renders a day earlier on the Cloudflare
// profile, and has since that profile shipped.
//
// It is deliberately left alone here: this change is meant to be
// behaviour-preserving, and taking a zone from configuration changes what
// every date on every page says. It wants its own commit. Flagged rather than
// quietly carried forward, because the first person to see it will reasonably
// assume translation caused it.
import { type Locale, intlTag } from "./locale.js";
import { formatNumber } from "./plural.js";

/** What an absent date, duration or size renders as. */
export const EMPTY_VALUE = "—";

type DateStyle = "long" | "short" | "dayMonth" | "monthShort" | "dateTime";

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  long: { year: "numeric", month: "long", day: "numeric" },
  short: { year: "numeric", month: "short", day: "numeric" },
  dayMonth: { month: "long", day: "numeric" },
  monthShort: { month: "short" },
  dateTime: {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  },
};

const dateFormatCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: Locale, style: DateStyle): Intl.DateTimeFormat {
  const key = `${locale}:${style}`;
  const cached = dateFormatCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(intlTag(locale), DATE_OPTIONS[style]);
  dateFormatCache.set(key, formatter);
  return formatter;
}

function formatDate(locale: Locale, style: DateStyle, ms: number | undefined | null): string {
  if (ms === undefined || ms === null) {
    return EMPTY_VALUE;
  }
  return dateFormatter(locale, style).format(new Date(ms));
}

/** "8 July 2026" / "8. července 2026" — song and event heroes. */
export function formatLongDate(locale: Locale, ms: number | undefined | null): string {
  return formatDate(locale, "long", ms);
}

/** "Jul 8, 2026" / "8. 7. 2026" — list rows, where the long form would not fit. */
export function formatShortDate(locale: Locale, ms: number | undefined | null): string {
  return formatDate(locale, "short", ms);
}

/**
 * "September 13" / "13. září" — an event named by its day, where the year is
 * the one everyone is living in (home's "Na pultu" card).
 */
export function formatDayMonth(locale: Locale, ms: number | undefined | null): string {
  return formatDate(locale, "dayMonth", ms);
}

/**
 * Just the month, abbreviated — the event ledger's date chip.
 *
 * The original hardcoded `en-GB` here while the rest of the app used `en-US`,
 * with a comment explaining the divergence: `en-US` abbreviates September as
 * "Sep" and `en-GB` as "Sept", and the chip is drawn to a width. That reason
 * dies with the hardcoded locale — a Czech reader gets Czech month
 * abbreviations either way — so this now follows the reader's language like
 * every other date, and the chip has to cope with whatever the language is.
 */
export function formatMonthShort(locale: Locale, ms: number | undefined | null): string {
  return formatDate(locale, "monthShort", ms);
}

/**
 * A date and a time together — admin tables' "last seen", "created",
 * "last used".
 *
 * This used to be a locale-INDEPENDENT `en-CA` formatter, on the argument
 * that `2026-09-09 10:17` is machine-readable technical data in a mono column
 * rather than a date anyone reads aloud. The owner overruled it: on a Czech
 * page it just reads as unformatted, and the column is being read by a person
 * either way. It follows the reader now, like every other date.
 */
export function formatDateTime(locale: Locale, ms: number | undefined | null): string {
  return formatDate(locale, "dateTime", ms);
}

/**
 * `durationMs` as `m:ss` (or `h:mm:ss` past an hour) — takes are minutes long,
 * never sub-second.
 *
 * Takes no locale. A running time is digits and colons in every language this
 * app is likely to speak, and `Intl.DurationFormat` would render "4 min 32 s",
 * which is not what a transport control shows.
 */
export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) {
    return EMPTY_VALUE;
  }
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/**
 * A byte count as a human `MB`/`KB`/`B` figure.
 *
 * SI units (1000, not 1024) — which is what the server-side formatter always
 * used, what macOS and every file manager the band will compare against
 * report, and what a hosting bill counts in.
 *
 * There were TWO implementations of this before: the server's, on 1000, and a
 * second one inside `AssetUploader.tsx` on 1024. The same file could be
 * described as 84.0 MB while uploading and 88.1 MB in the asset list once it
 * landed. One of them had to go; this is the one that stayed.
 *
 * The unit words are not translated — MB and KB are the same symbols in Czech
 * — but the NUMBER is, so a size reads "84,3 MB" rather than "84.3 MB".
 */
export function formatBytes(locale: Locale, bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${oneDecimal(locale, bytes / 1_000_000)} MB`;
  }
  if (bytes >= 1_000) {
    return `${oneDecimal(locale, bytes / 1_000)} KB`;
  }
  return `${formatNumber(locale, bytes)} B`;
}

const oneDecimalCache = new Map<Locale, Intl.NumberFormat>();

/**
 * Exactly one decimal place, always — "6,0 MB", never "6 MB".
 *
 * `Intl.NumberFormat` drops a trailing zero unless told not to, and a column
 * of sizes where some have a decimal and some do not stops lining up. The
 * originals used `.toFixed(1)`, which kept the zero; this keeps it too, while
 * still getting the language's decimal separator right.
 */
function oneDecimal(locale: Locale, value: number): string {
  const cached = oneDecimalCache.get(locale);
  if (cached) {
    return cached.format(value);
  }
  const formatter = new Intl.NumberFormat(intlTag(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  oneDecimalCache.set(locale, formatter);
  return formatter.format(value);
}

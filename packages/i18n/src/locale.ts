// Which languages bandplate speaks, and how a request's language is decided.
//
// --- Why a package of its own ---------------------------------------------
//
// It has NO dependencies, and that is the point rather than a coincidence.
//
// No island imports a `@bandplate/*` package today: `Player`, `VoteFavorite`,
// `AssetUploader` and `ChartEditor` reach for `preact`, `@nanostores/preact`
// and `../client/*` and nothing else. Put the message catalogs in
// `packages/core` and the first island import drags the core barrel — and
// therefore `@bandplate/db`, drizzle and zod — into the Vite CLIENT graph.
// Tree-shaking would probably rescue that. "Probably" is not a thing to bet a
// 60KB island budget on, and a zero-dependency package makes it structurally
// impossible instead.
//
// `packages/ui` deliberately does NOT depend on this. Its entire user-facing
// vocabulary is seven strings, which it now takes as props — see
// `Pagination.astro`'s `PaginationLabels`. The brand layer stays a brand
// layer.

/**
 * Every language the app can render.
 *
 * English is first because it is the default, and because the English catalog
 * is the shape every other one is checked against — see `messages/types.ts`.
 */
export const LOCALES = ["en", "cs"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * The BCP 47 tag each locale formats with.
 *
 * Separate from the locale id because the id is what a member picks and what
 * `members.locale` stores — a short, stable key — while `Intl` wants a region
 * to get dates and numbers right. Czech renders "8. července 2026" and
 * "1 234,5" under `cs-CZ`.
 */
const INTL_TAGS: Record<Locale, string> = {
  en: "en-US",
  cs: "cs-CZ",
};

export function intlTag(locale: Locale): string {
  return INTL_TAGS[locale];
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks a locale from an `Accept-Language` header.
 *
 * This is only ever the THIRD thing consulted: a signed-in member's own
 * setting wins, then the `bp_locale` cookie recording an earlier choice, and
 * only then the browser's own preference. It exists for exactly one case — the
 * first time somebody reaches `/login` or `/setup`, where there is no member
 * row to read and no cookie yet.
 *
 * Deliberately small. It reads the quality-ordered list, takes the primary
 * subtag of each entry (so `cs-CZ` and `cs` both match Czech), and returns the
 * first one we speak. It does NOT implement RFC 4647 lookup with wildcards or
 * `*;q=0`: a two-language private archive does not need it, and a bigger
 * matcher would be more code to be subtly wrong.
 *
 * A malformed header is not an error — a missing, empty or unparseable
 * `Accept-Language` simply means "no opinion", and no opinion means English.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) {
    return DEFAULT_LOCALE;
  }

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.split(";").map((piece) => piece.trim());
      const qParam = params.find((piece) => piece.startsWith("q="));
      // An entry with no `q` is q=1. An unparseable one sorts last rather than
      // taking the header down with it.
      const quality = qParam === undefined ? 1 : Number.parseFloat(qParam.slice(2));
      return { tag: tag.toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag !== "" && entry.quality > 0)
    // Stable within equal quality, so the header's own order breaks ties —
    // `Array.prototype.sort` is required to be stable since ES2019.
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    if (isLocale(primary)) {
      return primary;
    }
  }

  return DEFAULT_LOCALE;
}

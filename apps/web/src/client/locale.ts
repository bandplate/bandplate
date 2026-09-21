// Which language the page an island is standing in is written in.
//
// Read off `<html lang>`, not passed in as a prop, and that is deliberate.
//
// `Player`, `VoteFavorite` and `ConfirmDialog` are `transition:persist` — when
// `<ClientRouter />` swaps a page, those islands are MOVED into the new
// document rather than remounted, so anything handed to them at hydration is
// whatever the first page they appeared on happened to say. A locale passed as
// a prop would go stale the moment a member changed their language, and stay
// stale until they closed the tab.
//
// The document's own `lang` attribute is always current — it is server
// rendered on every response — so reading it at the moment the string is
// needed is both simpler and more correct than plumbing a value through.
//
// (The language picker on `/me` still forces a full document load with
// `data-astro-reload`, because a persisted island's already-rendered DOM
// cannot re-translate itself. That is a separate problem from this one.)
import { DEFAULT_LOCALE, isLocale, type Locale } from "@bandplate/i18n";

/**
 * @param fallback What to use when there is no document to read.
 *
 * An island with `client:load` is SERVER-rendered before it hydrates, and
 * there is no `document` on the server — so without a fallback that first
 * pass is always English, and a Czech reader gets an English `aria-label`
 * baked into the HTML until hydration replaces it. Islands that render text
 * server-side therefore take a `locale` prop and pass it here; the live
 * `<html lang>` still wins in the browser, which is what keeps a persisted
 * island correct after the language changes.
 */
export function currentLocale(fallback: Locale = DEFAULT_LOCALE): Locale {
  if (typeof document === "undefined") {
    return fallback;
  }
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : fallback;
}

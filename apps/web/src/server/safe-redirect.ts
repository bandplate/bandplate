// Where a no-JS vote/favorite form POST redirects back to — "wherever the
// member was" (a take row on `/`, `/search`, a song page, an event page,
// `/me`), not a hardcoded destination, since the same control renders on
// every one of those pages. The browser's own `Referer` header already
// carries that (a same-origin form submission sends it unless a page opts
// out, which none here does), so there's no need to thread a `redirect`
// prop through every caller of `VoteToggle`/`FavoriteToggle`.
//
// Never trusted blindly: an open redirect (a header-controlled destination
// forwarded verbatim) would let a malicious or compromised page send a
// member's own POST to an off-site URL of the attacker's choosing. Only
// the PATH+SEARCH of a `Referer` that is same-origin with `appOrigin` is
// ever used; anything else (a missing header, a cross-origin one, garbage)
// falls back to the caller-supplied default.
export function safeRedirectPath(
  refererHeader: string | null,
  appOrigin: string,
  fallback: string,
): string {
  if (!refererHeader) {
    return fallback;
  }
  let referer: URL;
  try {
    referer = new URL(refererHeader);
  } catch {
    return fallback;
  }
  if (referer.origin !== appOrigin) {
    return fallback;
  }
  // A pathname starting with `//` is protocol-relative: returned bare as a
  // `Location` header (no scheme, no host of our own in front of it), a
  // browser resolves `//evil.example/x` to `http://evil.example/x` — an
  // open redirect even though `referer.origin` above matched `appOrigin`.
  // The WHATWG URL parser already folds a leading backslash into `/` for
  // special schemes (`http://host/\evil.example` parses to pathname
  // `//evil.example`), so this one check also covers that variant.
  if (referer.pathname.startsWith("//")) {
    return fallback;
  }
  return `${referer.pathname}${referer.search}`;
}

/**
 * The origin a candidate path is resolved against. Never sent anywhere: it
 * exists so the WHATWG parser can answer "does this string stay on the site it
 * was resolved against?", which is the only question being asked.
 */
const PROBE_ORIGIN = "https://app.invalid";

/**
 * A destination a FORM asked for, checked before anything redirects to it.
 *
 * `returnTo` on a stash sheet is where its caller wants the member back — the
 * song page's own section sends its own URL, the stash view sends nothing. The
 * field travels through the browser, so it is the member's to edit and an
 * attacker's to plant: forwarded verbatim it is an open redirect, which a
 * background security scan flagged as one.
 *
 * Only a path ON THIS APP survives: it starts with `/`, it is not the
 * protocol-relative `//host` (nor the backslash variant the URL parser folds
 * into it), it carries no scheme, and resolving it leaves it on the origin it
 * was resolved against. Anything else answers `null`, and the caller falls
 * back to a destination it chose itself.
 */
export function safeAppPath(candidate: string | null | undefined): string | null {
  const value = candidate?.trim();
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) {
    return null;
  }
  return `${url.pathname}${url.search}`;
}

/**
 * Adds one `name=value` to a path that may already carry a query — `?` the
 * first time, `&` after that. `/songs/coudy` + `published=1` is
 * `/songs/coudy?published=1`; `/takes?stash=1` + `deleted=x` is
 * `/takes?stash=1&deleted=x`, where a second `?` would have made the whole
 * thing one unreadable parameter.
 */
export function withQuery(path: string, query: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

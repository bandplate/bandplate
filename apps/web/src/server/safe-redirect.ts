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

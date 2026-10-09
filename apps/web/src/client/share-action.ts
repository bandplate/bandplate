// The Share button's decisions, pulled out of `ShareButton.tsx` so a node test
// can check them without a DOM: which URL goes out, by which mechanism, and
// what a failed share means.
//
// The constraint everything here bends around: iOS Safari only lets
// `navigator.share` run inside the tap's own task. Awaiting a fetch between
// the tap and the call loses the gesture and the share sheet never opens.
// So the short link is asked for in the background as soon as the page is
// idle, and a tap shares whatever is already known, synchronously: the short
// link when it has arrived, the page's own address when it has not (or its
// request failed). The button works either way.

/** What the island needs from `navigator`, so a test can hand in a fake. */
export interface ShareCapabilities {
  share?: unknown;
}

export type ShareMechanism = "share" | "copy";

/** The system share sheet where there is one (phones), the clipboard where not (most desktops). */
export function shareMechanism(nav: ShareCapabilities | undefined): ShareMechanism {
  return typeof nav?.share === "function" ? "share" : "copy";
}

/**
 * The absolute URL a tap shares.
 *
 * `shortPath` is what `/share` answered (`/s/<code>`), when it has; otherwise
 * the page's own path. The page's QUERY is dropped on purpose: it carries
 * one-shot flags (`?saved=1`, `?created=1`) that would greet whoever opens
 * the link with a banner about somebody else's edit.
 */
export function shareUrl(
  shortPath: string | undefined,
  location: { origin: string; pathname: string },
): string {
  return new URL(shortPath ?? location.pathname, location.origin).href;
}

/** `SHARE_CODE_LENGTH` (10) spelled out: `@bandplate/core` is not shipped to the browser. */
const SHORT_PATH = /^\/s\/[0-9A-Za-z]{10}$/;

/**
 * The short path out of `/share`'s JSON answer, or undefined for anything
 * that is not exactly `{ url: "/s/<code>" }`. Never an absolute URL from the
 * server: the client builds that from its own origin.
 */
export function shortPathFrom(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const url = (body as { url?: unknown }).url;
  return typeof url === "string" && SHORT_PATH.test(url) ? url : undefined;
}

/**
 * What to do after `navigator.share` rejects.
 *
 * `AbortError` is the person closing the share sheet: their choice, so
 * nothing happens and nothing is announced. `InvalidStateError` is a sheet
 * that is already open (a double tap): the first press is still doing its
 * job, so the second must not copy over it. Anything else (a browser that
 * has the method but refuses this call, a permissions policy) falls back to
 * the clipboard, so the press still does something.
 */
const IGNORED_SHARE_ERRORS = new Set(["AbortError", "InvalidStateError"]);

export function afterShareError(error: unknown): "ignore" | "copy" {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && IGNORED_SHARE_ERRORS.has(name) ? "ignore" : "copy";
}

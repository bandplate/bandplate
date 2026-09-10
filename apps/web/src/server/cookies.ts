// Session cookie helpers for Astro's `AstroCookies` API — mirrors
// `@bandplate/api`'s `cookies.ts` exactly (same name, same attributes), since
// Astro pages set/clear the session cookie directly (they call
// `@bandplate/core`'s auth services, not the HTTP API) and the two must stay
// interchangeable: a session started via `/setup` (Astro) must resolve the
// same way through the API's own cookie parsing, and vice versa.
import { type Locale, isLocale } from "@bandplate/i18n";
import type { AstroCookies } from "astro";

export const SESSION_COOKIE_NAME = "bp_session";

const SESSION_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export interface CookieSecurity {
  cookieSecure: boolean;
}

export function setSessionCookie(
  cookies: AstroCookies,
  rawToken: string,
  security: CookieSecurity,
): void {
  cookies.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: security.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(cookies: AstroCookies, security: CookieSecurity): void {
  cookies.delete(SESSION_COOKIE_NAME, { path: "/", secure: security.cookieSecure });
}

// ---------------------------------------------------------------------------
// bp_locale
// ---------------------------------------------------------------------------

/**
 * Which language to render for someone with NO session.
 *
 * `/login`, `/login/[token]` and `/setup` have no member row to read a
 * preference from, and a Czech band should not have to read an English sign-in
 * page every time. So the language a member picks on `/me` is also written
 * here, and the door speaks whatever they last chose.
 *
 * Deliberately NOT `httpOnly`, unlike the session cookie: this is a display
 * preference, not a credential. There is nothing to protect and no reason a
 * script should not be able to read it.
 *
 * Deliberately NOT cleared on logout — clearing it is exactly the bug it
 * exists to prevent, since logout lands you back on the sign-in page.
 */
export const LOCALE_COOKIE_NAME = "bp_locale";

const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function setLocaleCookie(
  cookies: AstroCookies,
  locale: Locale,
  security: CookieSecurity,
): void {
  cookies.set(LOCALE_COOKIE_NAME, locale, {
    httpOnly: false,
    secure: security.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
  });
}

/** The cookie's value, or `undefined` if it is absent or names a language we do not speak. */
export function readLocaleCookie(cookies: AstroCookies): Locale | undefined {
  const value = cookies.get(LOCALE_COOKIE_NAME)?.value;
  return isLocale(value) ? value : undefined;
}

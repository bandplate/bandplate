// Session cookie helpers for Astro's `AstroCookies` API — mirrors
// `@bandplate/api`'s `cookies.ts` exactly (same name, same attributes), since
// Astro pages set/clear the session cookie directly (they call
// `@bandplate/core`'s auth services, not the HTTP API) and the two must stay
// interchangeable: a session started via `/setup` (Astro) must resolve the
// same way through the API's own cookie parsing, and vice versa.
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

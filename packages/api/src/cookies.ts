import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE_NAME = "bp_session";

// 365 days, in seconds (Max-Age is seconds, not ms).
const SESSION_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export interface CookieSecurity {
  /** Whether to mark the cookie `Secure`. `false` only for non-TLS local dev. */
  secure: boolean;
}

/**
 * Sets `bp_session` with exactly: HttpOnly, (Secure), SameSite=Lax, Path=/,
 * Max-Age=31536000. `SameSite=Lax` is deliberate — the login link arrives
 * from an external mail client, and `Strict` would land the post-login
 * redirect logged out.
 */
export function setSessionCookie(c: Context, rawToken: string, security: CookieSecurity): void {
  setCookie(c, SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: security.secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(c: Context, security: CookieSecurity): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/", secure: security.secure });
}

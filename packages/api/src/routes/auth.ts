import type { AuthDeps, RateLimiter } from "@bandlib/core";
import { consumeLoginToken, peekLoginToken, requestLogin, revokeSession } from "@bandlib/core";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { SESSION_COOKIE_NAME, clearSessionCookie, setSessionCookie } from "../cookies.js";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, publicRoute } from "../route-registry.js";

const LOGIN_EMAIL_LIMIT = 5;
const LOGIN_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_LIMIT = 20;
const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;

const loginBodySchema = z.object({ email: z.string().trim().min(1).max(320) });

export interface AuthRouteDeps {
  auth: AuthDeps;
  rateLimiter: RateLimiter;
  appOrigin: string;
  cookieSecure: boolean;
}

// Identical body for every outcome — whitelisted, unknown, or disabled —
// so the response itself carries no signal about which one happened.
const LOGIN_ACCEPTED_BODY = { ok: true } as const;

export function registerAuthRoutes(router: GuardedRouter, deps: AuthRouteDeps): void {
  router.post("/auth/login", publicRoute(), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = loginBodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(c, 400, "invalid_body", "A valid email is required.");
    }

    const ip = c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown";
    const emailKey = `login:email:${parsed.data.email.toLowerCase()}`;
    const ipKey = `login:ip:${ip}`;

    const [emailLimit, ipLimit] = await Promise.all([
      deps.rateLimiter.check(emailKey, LOGIN_EMAIL_LIMIT, LOGIN_EMAIL_WINDOW_MS),
      deps.rateLimiter.check(ipKey, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS),
    ]);

    if (!emailLimit.allowed || !ipLimit.allowed) {
      return errorResponse(c, 429, "rate_limited", "Too many login requests. Try again later.");
    }

    // `requestLogin` returns void either way — the route has no signal to
    // leak even if it wanted to.
    await requestLogin(deps.auth, parsed.data.email, {
      requestedIp: ip === "unknown" ? null : ip,
      buildLoginUrl: (rawToken) => `${deps.appOrigin}/login/${rawToken}`,
    });

    return c.json(LOGIN_ACCEPTED_BODY, 202);
  });

  router.get("/auth/login/:token", publicRoute(), async (c) => {
    const token = c.req.param("token");
    c.header("Cache-Control", "no-store");
    if (!token) {
      return errorResponse(c, 400, "invalid_request", "Missing token parameter.");
    }

    const result = await peekLoginToken(deps.auth, token);
    if (!result.valid) {
      return errorResponse(c, 404, "invalid_token", "This login link is invalid or has expired.");
    }
    return c.json({ valid: true, displayName: result.displayName });
  });

  router.post("/auth/login/:token", publicRoute(), async (c) => {
    const token = c.req.param("token");
    if (!token) {
      return errorResponse(c, 400, "invalid_request", "Missing token parameter.");
    }

    const result = await consumeLoginToken(deps.auth, token, {
      userAgent: c.req.header("user-agent") ?? null,
    });

    if (!result.ok || !result.sessionToken) {
      return errorResponse(c, 404, "invalid_token", "This login link is invalid or has expired.");
    }

    setSessionCookie(c, result.sessionToken, { secure: deps.cookieSecure });
    return c.json({ ok: true });
  });

  router.post("/auth/logout", publicRoute(), async (c) => {
    const cookie = getCookie(c, SESSION_COOKIE_NAME);
    if (cookie) {
      await revokeSession(deps.auth, cookie);
    }
    clearSessionCookie(c, { secure: deps.cookieSecure });
    return c.json({ ok: true });
  });

  router.get("/auth/me", publicRoute(), async (c) => {
    const principal = c.get("principal");
    if (!principal) {
      return errorResponse(c, 401, "unauthenticated", "Not logged in.");
    }
    return c.json({ principal });
  });
}

import type { AuthDeps, RateLimiter } from "@bandplate/core";
import { consumeLoginToken, peekLoginToken, requestLogin, revokeSession } from "@bandplate/core";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { SESSION_COOKIE_NAME, clearSessionCookie, setSessionCookie } from "../cookies.js";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, publicRoute } from "../route-registry.js";

// Exported so other front doors onto the same login flow (currently:
// apps/web's Astro `/login` page, which calls `requestLogin` directly
// rather than round-tripping through this HTTP route — see its brief for
// why) apply the exact same rate-limit policy instead of a second,
// independently-tuned copy that could drift from this one.
export const LOGIN_EMAIL_LIMIT = 5;
export const LOGIN_EMAIL_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;

/**
 * Number of reverse proxy hops in front of this app that are trusted to
 * have appended their own observed peer to `X-Forwarded-For`. Most
 * deployments sit behind exactly one (the platform's own edge/proxy), so 1
 * is a safe default; a deployment with an extra internal load balancer
 * would set this higher.
 */
export const DEFAULT_TRUSTED_PROXY_DEPTH = 1;

const loginBodySchema = z.object({ email: z.string().trim().min(1).max(320) });

export interface AuthRouteDeps {
  auth: AuthDeps;
  rateLimiter: RateLimiter;
  appOrigin: string;
  cookieSecure: boolean;
  /** See `DEFAULT_TRUSTED_PROXY_DEPTH`. */
  trustedProxyDepth?: number;
  /**
   * Workers profile only. When `true`, `POST /auth/login` schedules the
   * login-link send via `c.executionCtx.waitUntil` instead of awaiting it
   * inline — see `requestLogin`'s `deferMailSend` doc comment in
   * `@bandplate/core`. `c.executionCtx` is per-request (Hono populates it
   * from the `ctx` argument of the Workers `fetch(request, env, ctx)`
   * handler), so this is read fresh on every request rather than baked
   * into the (once-per-isolate) `deps` this router closes over. Left
   * unset/`false` on the Node/container profile, which keeps awaiting the
   * send inline exactly as before.
   */
  enableDeferredMailSend?: boolean;
}

/**
 * Extracts the caller's IP for rate-limiting purposes. `X-Forwarded-For`
 * is a spoofable, attacker-suppliable header in general — most proxies
 * *append* the peer they see to whatever value arrived with the request,
 * rather than replacing it, so an attacker can prepend an arbitrary fake
 * prefix and get a fresh rate-limit bucket on every request by varying it.
 * Only the entries appended by proxies we actually trust are meaningful:
 * with `trustedProxyDepth` trusted hops in front of us, the real client is
 * `trustedProxyDepth` entries from the *right* end of the list, not the
 * first (leftmost) one. `CF-Connecting-IP`, when present, is set directly
 * by Cloudflare's edge and isn't client-suppliable at all, so it's
 * preferred outright.
 */
/**
 * Takes a `Headers`-shaped getter rather than a Hono `Context` so it can be
 * called from any HTTP layer — the Astro `/login` page passes
 * `request.headers.get` directly.
 */
export function extractClientIp(headers: Pick<Headers, "get">, trustedProxyDepth: number): string {
  const cfConnectingIp = headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const hops = xForwardedFor
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    if (hops.length > 0) {
      const depth = Math.max(1, trustedProxyDepth);
      const index = Math.min(Math.max(hops.length - depth, 0), hops.length - 1);
      const hop = hops[index];
      if (hop) {
        return hop;
      }
    }
  }

  return "unknown";
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

    const ip = extractClientIp(
      c.req.raw.headers,
      deps.trustedProxyDepth ?? DEFAULT_TRUSTED_PROXY_DEPTH,
    );
    const emailKey = `login:email:${parsed.data.email.toLowerCase()}`;
    const ipKey = `login:ip:${ip}`;

    const [emailLimit, ipLimit] = await Promise.all([
      deps.rateLimiter.check(emailKey, LOGIN_EMAIL_LIMIT, LOGIN_EMAIL_WINDOW_MS),
      deps.rateLimiter.check(ipKey, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS),
    ]);

    if (!emailLimit.allowed || !ipLimit.allowed) {
      const retryAfterMs = Math.max(emailLimit.retryAfterMs, ipLimit.retryAfterMs);
      c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      return errorResponse(c, 429, "rate_limited", "Too many login requests. Try again later.");
    }

    // `requestLogin` returns void either way — the route has no signal to
    // leak even if it wanted to.
    const deferMailSend = deps.enableDeferredMailSend
      ? (send: () => Promise<void>) => c.executionCtx.waitUntil(send())
      : undefined;
    await requestLogin({ ...deps.auth, deferMailSend }, parsed.data.email, {
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

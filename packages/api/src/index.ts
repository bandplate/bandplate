import type { AuthDeps, Clock, Mailer, RateLimiter, Sleep, Storage } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import { Hono } from "hono";
import { errorResponse } from "./errors.js";
import { originCheckMiddleware } from "./middleware/origin.js";
import { principalMiddleware } from "./middleware/principal.js";
import { GuardedRouter, assertEveryRouteIsGuarded, publicRoute } from "./route-registry.js";
import { registerAdminInstrumentRoutes } from "./routes/admin-instruments.js";
import { registerAdminMemberRoutes } from "./routes/admin-members.js";
import { registerAdminTokenRoutes } from "./routes/admin-tokens.js";
import { registerAudioRoutes } from "./routes/audio.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerFavoriteRoutes } from "./routes/favorites.js";
import { registerIngestRoutes } from "./routes/ingest/index.js";
import { registerPushRoutes } from "./routes/push.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerTakeAssetRoutes } from "./routes/take-assets.js";
import { registerVoteRoutes } from "./routes/votes.js";
import type { AppEnv } from "./types.js";

export interface AppConfig {
  /** The exact browser origin the app is served from — checked on every mutating request. */
  appOrigin: string;
  /** Compared against a bootstrap request's supplied token (see `bootstrapAdmin`). */
  bootstrapToken: string;
  /** Whether `bp_session` is marked `Secure`. `false` only for non-TLS local dev. */
  cookieSecure: boolean;
  /**
   * Number of trusted reverse-proxy hops in front of this app, for
   * extracting the real client IP out of `X-Forwarded-For` (see
   * `routes/auth.ts`'s `extractClientIp`). Defaults to 1.
   */
  trustedProxyDepth?: number;
  /** See `AuthRouteDeps.enableDeferredMailSend` in `routes/auth.ts`. Workers profile only. */
  enableDeferredMailSend?: boolean;
  /**
   * Web Push, when configured. `publicKey` is what a subscribing browser's
   * `pushManager.subscribe` needs as `applicationServerKey`; `keyId` (see
   * `@bandplate/push`'s `vapidKeyId`) is what gets stamped onto every stored
   * subscription, so a later VAPID key rotation can tell stale subscriptions
   * apart from current ones without re-deriving the id each time. Undefined
   * when push notifications are off — never the private key, which routes
   * never need and must not be able to leak.
   */
  push?: { publicKey: string; keyId: string };
}

/**
 * Dependencies injected into the API app. Every route handler reaches the
 * outside world only through these — no route imports a concrete driver,
 * a concrete mailer, or `Date.now()` directly.
 */
export interface AppDeps {
  db: Db;
  mailer: Mailer;
  clock: Clock;
  rateLimiter: RateLimiter;
  storage: Storage;
  config: AppConfig;
  /**
   * Overrides for `requestLogin`'s timing-side-channel clamp (see
   * `@bandplate/core`'s `DEFAULT_LOGIN_TIMING_FLOOR_MS`/`Sleep`). Tests
   * inject a fast, non-blocking `sleep` here; production omits both and
   * gets the real defaults (a real wait, floor 300ms).
   */
  loginTimingFloorMs?: number;
  sleep?: Sleep;
}

/**
 * Builds the app and hands back the `GuardedRouter` alongside it, purely so
 * tests can inspect `router.registry` directly (real route-coverage
 * assertions, not a synthetic stand-in). `createApp` below is the public
 * entry point and only returns the `Hono` instance.
 */
export function buildRoutedApp(deps: AppDeps): { app: Hono<AppEnv>; router: GuardedRouter } {
  const app = new Hono<AppEnv>();
  const router = new GuardedRouter(app);

  // Both of these are Hono instance-level handlers, not routes — they
  // don't appear in `app.routes` and so aren't (and don't need to be)
  // covered by `assertEveryRouteIsGuarded`. Without them, an unmatched
  // path falls through to Hono's plain-text "404 Not Found" instead of
  // the app's `{error:{code,message}}` shape, and an unhandled throw
  // falls through to Hono's default handler — a generic 500, but with the
  // exception text (a driver error string, potentially) reaching the
  // client and/or an unfiltered `err` reaching logs. Neither ever
  // includes raw exception text in the response.
  app.notFound((c) => errorResponse(c, 404, "not_found", "Not found."));
  app.onError((err, c) => {
    console.error("[api] unhandled error", err);
    return errorResponse(c, 500, "internal_error", "An unexpected error occurred.");
  });

  const auth: AuthDeps = {
    db: deps.db,
    mailer: deps.mailer,
    clock: deps.clock,
    bootstrapToken: deps.config.bootstrapToken,
    loginTimingFloorMs: deps.loginTimingFloorMs,
    sleep: deps.sleep,
  };

  // Middleware order matters: principal resolution first (origin check and
  // scope checks both need `c.get("principal")`), then the origin check,
  // then each route's own `requireScopes`/`publicRoute` declaration.
  //
  // Registered via `router.use`, not `app.use` — that's what lets
  // `assertEveryRouteIsGuarded` tell these two legitimate global
  // middleware registrations apart from a stray/malicious `app.use(...)`
  // or `app.all(...)` reaching the live Hono instance some other way.
  router.use("*", principalMiddleware(auth));
  router.use("*", originCheckMiddleware(deps.config.appOrigin));

  router.get("/health", publicRoute(), (c) => c.json({ ok: true }));

  registerAuthRoutes(router, {
    auth,
    rateLimiter: deps.rateLimiter,
    appOrigin: deps.config.appOrigin,
    cookieSecure: deps.config.cookieSecure,
    trustedProxyDepth: deps.config.trustedProxyDepth,
    enableDeferredMailSend: deps.config.enableDeferredMailSend,
  });
  registerSetupRoutes(router, { db: deps.db, auth, cookieSecure: deps.config.cookieSecure });
  registerAdminMemberRoutes(router, {
    db: deps.db,
    auth,
    appOrigin: deps.config.appOrigin,
  });
  registerAdminInstrumentRoutes(router, { db: deps.db, clock: deps.clock });
  registerAdminTokenRoutes(router, { db: deps.db, auth });
  registerAudioRoutes(router, { db: deps.db, storage: deps.storage });
  registerVoteRoutes(router, { db: deps.db, clock: deps.clock });
  registerFavoriteRoutes(router, { db: deps.db, clock: deps.clock });
  registerPushRoutes(router, { db: deps.db, clock: deps.clock, push: deps.config.push });
  registerIngestRoutes(router, { db: deps.db, clock: deps.clock, storage: deps.storage });
  registerTakeAssetRoutes(router, { db: deps.db, clock: deps.clock, storage: deps.storage });

  // The structural backstop: fails app construction itself if any route on
  // the live Hono instance doesn't correspond to a GuardedRouter
  // declaration. See route-registry.ts for the full rationale.
  assertEveryRouteIsGuarded(app, router);

  return { app, router };
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  return buildRoutedApp(deps).app;
}

export type { AppEnv } from "./types.js";
export {
  GuardedRouter,
  publicRoute,
  requireScopes,
  requireServiceScopes,
} from "./route-registry.js";
// Re-exported so other front doors onto the login flow (apps/web's Astro
// `/login` page) can apply the exact same rate-limit policy and client-IP
// extraction instead of a second, independently-tuned copy. See
// routes/auth.ts's doc comments on these.
export {
  DEFAULT_TRUSTED_PROXY_DEPTH,
  LOGIN_EMAIL_LIMIT,
  LOGIN_EMAIL_WINDOW_MS,
  LOGIN_IP_LIMIT,
  LOGIN_IP_WINDOW_MS,
  extractClientIp,
} from "./routes/auth.js";

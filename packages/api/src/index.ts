import type { AuthDeps, Clock, Mailer, RateLimiter } from "@bandlib/core";
import type { Db } from "@bandlib/db";
import { Hono } from "hono";
import { originCheckMiddleware } from "./middleware/origin.js";
import { principalMiddleware } from "./middleware/principal.js";
import { GuardedRouter, assertEveryRouteIsGuarded, publicRoute } from "./route-registry.js";
import { registerAdminInstrumentRoutes } from "./routes/admin-instruments.js";
import { registerAdminMemberRoutes } from "./routes/admin-members.js";
import { registerAdminTokenRoutes } from "./routes/admin-tokens.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerSetupRoutes } from "./routes/setup.js";
import type { AppEnv } from "./types.js";

export interface AppConfig {
  /** The exact browser origin the app is served from — checked on every mutating request. */
  appOrigin: string;
  /** Compared against a bootstrap request's supplied token (see `bootstrapAdmin`). */
  bootstrapToken: string;
  /** Whether `bl_session` is marked `Secure`. `false` only for non-TLS local dev. */
  cookieSecure: boolean;
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
  config: AppConfig;
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

  const auth: AuthDeps = {
    db: deps.db,
    mailer: deps.mailer,
    clock: deps.clock,
    bootstrapToken: deps.config.bootstrapToken,
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
  });
  registerSetupRoutes(router, { db: deps.db, auth, cookieSecure: deps.config.cookieSecure });
  registerAdminMemberRoutes(router, { db: deps.db, auth });
  registerAdminInstrumentRoutes(router, { db: deps.db, clock: deps.clock });
  registerAdminTokenRoutes(router, { db: deps.db, auth });

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
export { GuardedRouter, publicRoute, requireScopes } from "./route-registry.js";

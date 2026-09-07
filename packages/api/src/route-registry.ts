import type { Scope } from "@bandlib/core";
import { hasAllScopes } from "@bandlib/core";
// The mechanism that makes an unguarded route structurally impossible.
//
// `createApp` never calls `app.get`/`app.post`/etc. directly for an actual
// resource route — every one goes through a `GuardedRouter`, whose method
// signatures make the guard argument mandatory: `router.get(path, handler)`
// (two args) simply does not type-check, because the middle parameter isn't
// optional. A developer adding a route has to reach for either
// `requireScopes(...)` or `publicRoute()` to even get the call to compile.
//
// That closes the "forgot to add a check" failure mode, but not "used
// `app.get` directly instead of `router.get`" — Hono's own API is still
// sitting right there on the same object. So there's a second, independent
// backstop: `assertEveryRouteIsGuarded`, called at the end of `createApp`
// itself (not just from a test), which walks the live Hono route table
// (`app.routes`) and throws if anything appears there that the router didn't
// register. That makes the check load-bearing at boot time, not just in CI —
// a route registered by mistake via the raw `app` object fails the app's own
// construction, in every environment, before it can ever serve a request.
// The coverage test in `route-registry.test.ts` exercises the same function
// directly so a regression here is caught without needing to boot the app.
import type { Context, Hono, MiddlewareHandler } from "hono";
import { mergePath } from "hono/utils/url";
import type { AppEnv } from "./types.js";

export type RouteGuard =
  | { public: true }
  | { scopes: readonly Scope[]; requireServiceToken?: boolean };

/** Marks a route as intentionally reachable with no principal at all. */
export function publicRoute(): RouteGuard {
  return { public: true };
}

/** The only way to gate a route on scopes — declares what `hasAllScopes` will check. */
export function requireScopes(...scopes: Scope[]): RouteGuard {
  return { scopes };
}

/**
 * Like `requireScopes`, but for machine-to-machine routes that distinguish
 * `401` (no/malformed/unknown/revoked token — or a member session, which
 * is simply never a valid principal here) from `403` (a real service token
 * that just lacks the scope) — see the ingest contract v1 §2 and §9. Every
 * other route in this codebase collapses both cases into `403` (see
 * `scopes.test.ts`: "an anonymous caller gets 403 (not 500) from a scoped
 * route") — that behavior is unchanged for `requireScopes`; this is an
 * additive variant, not a replacement.
 */
export function requireServiceScopes(...scopes: Scope[]): RouteGuard {
  return { scopes, requireServiceToken: true };
}

export interface RegisteredRoute {
  method: string;
  path: string;
  guard: RouteGuard;
}

/** A recorded `app.use(...)` registration — see `GuardedRouter.use`. */
export interface RegisteredMiddleware {
  path: string;
}

type RouteHandler = (c: Context<AppEnv>) => Response | Promise<Response>;

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Method = (typeof METHODS)[number];

export class GuardedRouter {
  readonly registry: RegisteredRoute[] = [];
  /**
   * Global middleware registered via `use()` below — the only sanctioned
   * way to call `app.use`. `assertEveryRouteIsGuarded` treats any live
   * route whose method isn't one of `METHODS` (i.e. Hono's `"ALL"`, which
   * both `app.use` and `app.all` register under) as a violation unless it
   * has a matching entry here. This is deliberately narrow — it does not
   * exempt `app.use`/`app.all` in general, only the specific registrations
   * that went through this method.
   */
  readonly middlewareRegistry: RegisteredMiddleware[] = [];

  constructor(private readonly app: Hono<AppEnv>) {}

  /**
   * The only sanctioned way to register global middleware. Anything with
   * method `"ALL"` on the live Hono app that isn't recorded here — a stray
   * `app.use(...)` or, more importantly, an `app.all(...)` route someone
   * reaches for instead of `router.get`/`router.post`/etc. — fails
   * `assertEveryRouteIsGuarded`, and with it, `createApp()` itself.
   */
  use(path: string, handler: MiddlewareHandler<AppEnv>): void {
    // Normalized with the same `mergePath` Hono applies internally
    // (against its default `basePath` of `"/"`) so e.g. `"*"` is recorded
    // as `"/*"` here too, matching what shows up in `app.routes` — without
    // this, a correct `router.use("*", ...)` would still fail the
    // coverage check on a path mismatch alone.
    this.middlewareRegistry.push({ path: mergePath("/", path) });
    this.app.use(path, handler);
  }

  private register(method: Method, path: string, guard: RouteGuard, handler: RouteHandler): void {
    this.registry.push({ method: method.toUpperCase(), path, guard });

    this.app[method](path, async (c: Context<AppEnv>) => {
      if (!("public" in guard)) {
        const principal = c.get("principal");
        if (guard.requireServiceToken && (!principal || principal.kind !== "service")) {
          return c.json(
            { error: { code: "unauthorized", message: "A valid service token is required." } },
            401,
          );
        }
        if (!hasAllScopes(principal, guard.scopes)) {
          const missing = guard.scopes.filter((s) => !principal?.scopes.includes(s));
          return c.json(
            {
              error: {
                code: "forbidden",
                message: `Insufficient scope. Missing: ${missing.join(", ")}.`,
              },
            },
            403,
          );
        }
      }
      return handler(c);
    });
  }

  get(path: string, guard: RouteGuard, handler: RouteHandler): void {
    this.register("get", path, guard, handler);
  }

  post(path: string, guard: RouteGuard, handler: RouteHandler): void {
    this.register("post", path, guard, handler);
  }

  put(path: string, guard: RouteGuard, handler: RouteHandler): void {
    this.register("put", path, guard, handler);
  }

  patch(path: string, guard: RouteGuard, handler: RouteHandler): void {
    this.register("patch", path, guard, handler);
  }

  delete(path: string, guard: RouteGuard, handler: RouteHandler): void {
    this.register("delete", path, guard, handler);
  }
}

/**
 * Cross-checks the live Hono route table against what `GuardedRouter`
 * recorded — in both directions, and for both kinds of registration it
 * supports (scoped/public routes, and global middleware).
 *
 * Critically, this does NOT filter the live route table down to
 * `METHODS` first: any route registered with a method outside that list
 * (in practice, Hono's `"ALL"`, which both `app.use(...)` and
 * `app.all(...)` register under) is treated as a route needing a matching
 * declaration, exactly like a GET/POST/etc. route. `app.all("/backdoor",
 * ...)` reaching the live Hono instance with no corresponding
 * `middlewareRegistry`/`registry` entry is exactly the bypass this
 * function exists to catch — silently discarding "ALL" routes from the
 * check (as an earlier version of this function did, by filtering to
 * `METHODS` up front) would let it through unguarded.
 */
export function assertEveryRouteIsGuarded(app: Hono<AppEnv>, router: GuardedRouter): void {
  const isKnownMethod = (method: string) =>
    (METHODS as readonly string[]).includes(method.toLowerCase());

  const actualRoutes = app.routes
    .filter((r) => isKnownMethod(r.method))
    .map((r) => `${r.method.toUpperCase()} ${r.path}`);
  const declaredRoutes = router.registry.map((r) => `${r.method} ${r.path}`);

  const actualMiddleware = app.routes
    .filter((r) => !isKnownMethod(r.method))
    .map((r) => `${r.method.toUpperCase()} ${r.path}`);
  const declaredMiddleware = router.middlewareRegistry.map((m) => `ALL ${m.path}`);

  const problems: string[] = [
    ...diff(actualRoutes, declaredRoutes, "GuardedRouter route"),
    ...diff(actualMiddleware, declaredMiddleware, "GuardedRouter.use middleware"),
  ];

  if (problems.length > 0) {
    throw new Error(
      `Route(s) with no matching GuardedRouter declaration — every route must be registered via GuardedRouter with requireScopes(...)/publicRoute(), and every global middleware via GuardedRouter.use(...): ${problems.join("; ")}`,
    );
  }
}

function diff(actual: string[], declared: string[], declarationKind: string): string[] {
  const actualCounts = countBy(actual);
  const declaredCounts = countBy(declared);

  const problems: string[] = [];
  for (const [route, count] of actualCounts) {
    if (declaredCounts.get(route) !== count) {
      problems.push(
        `${route} (registered on the Hono app ${count}x, declared via ${declarationKind} ${declaredCounts.get(route) ?? 0}x)`,
      );
    }
  }
  for (const [route, count] of declaredCounts) {
    if (!actualCounts.has(route)) {
      problems.push(
        `${route} (declared via ${declarationKind} but not present on the Hono app — ${count}x)`,
      );
    }
  }
  return problems;
}

function countBy(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
}

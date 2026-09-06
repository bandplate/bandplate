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
import type { Context, Hono } from "hono";
import type { AppEnv } from "./types.js";

export type RouteGuard = { public: true } | { scopes: readonly Scope[] };

/** Marks a route as intentionally reachable with no principal at all. */
export function publicRoute(): RouteGuard {
  return { public: true };
}

/** The only way to gate a route on scopes — declares what `hasAllScopes` will check. */
export function requireScopes(...scopes: Scope[]): RouteGuard {
  return { scopes };
}

export interface RegisteredRoute {
  method: string;
  path: string;
  guard: RouteGuard;
}

type RouteHandler = (c: Context<AppEnv>) => Response | Promise<Response>;

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Method = (typeof METHODS)[number];

export class GuardedRouter {
  readonly registry: RegisteredRoute[] = [];

  constructor(private readonly app: Hono<AppEnv>) {}

  private register(method: Method, path: string, guard: RouteGuard, handler: RouteHandler): void {
    this.registry.push({ method: method.toUpperCase(), path, guard });

    this.app[method](path, async (c: Context<AppEnv>) => {
      if (!("public" in guard)) {
        const principal = c.get("principal");
        if (!hasAllScopes(principal, guard.scopes)) {
          return c.json({ error: { code: "forbidden", message: "Insufficient scope." } }, 403);
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
 * recorded. Anything present in one but not the other means a route was
 * registered outside the guard mechanism (or the guard mechanism silently
 * failed to register what it thinks it did) — either way, fail loudly
 * rather than serve it.
 */
export function assertEveryRouteIsGuarded(app: Hono<AppEnv>, router: GuardedRouter): void {
  const actualRoutes = app.routes
    .filter((r) => (METHODS as readonly string[]).includes(r.method.toLowerCase()))
    .map((r) => `${r.method.toUpperCase()} ${r.path}`);
  const declaredRoutes = router.registry.map((r) => `${r.method} ${r.path}`);

  const actualCounts = countBy(actualRoutes);
  const declaredCounts = countBy(declaredRoutes);

  const problems: string[] = [];
  for (const [route, count] of actualCounts) {
    if (declaredCounts.get(route) !== count) {
      problems.push(
        `${route} (registered on the Hono app ${count}x, declared via GuardedRouter ${declaredCounts.get(route) ?? 0}x)`,
      );
    }
  }
  for (const [route, count] of declaredCounts) {
    if (!actualCounts.has(route)) {
      problems.push(
        `${route} (declared via GuardedRouter but not present on the Hono app — ${count}x)`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Route(s) with no matching GuardedRouter declaration — every route must be registered via GuardedRouter with requireScopes(...) or publicRoute(): ${problems.join("; ")}`,
    );
  }
}

function countBy(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
}

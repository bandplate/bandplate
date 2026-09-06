import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  GuardedRouter,
  assertEveryRouteIsGuarded,
  publicRoute,
  requireScopes,
} from "./route-registry.js";
import { buildTestApp } from "./test-helpers.js";
import type { AppEnv } from "./types.js";

describe("assertEveryRouteIsGuarded", () => {
  it("passes when every registered route went through the GuardedRouter", () => {
    const app = new Hono<AppEnv>();
    const router = new GuardedRouter(app);
    router.get("/a", publicRoute(), (c) => c.json({}));
    router.post("/b", requireScopes("songs:read"), (c) => c.json({}));

    expect(() => assertEveryRouteIsGuarded(app, router)).not.toThrow();
  });

  it("throws when a route is registered directly on the Hono app, bypassing the router", () => {
    const app = new Hono<AppEnv>();
    const router = new GuardedRouter(app);
    router.get("/a", publicRoute(), (c) => c.json({}));
    // Simulates a future developer reaching for the raw Hono API instead of
    // the router — this is exactly the failure mode the check exists for.
    app.get("/sneaky", (c) => c.json({ leaked: true }));

    expect(() => assertEveryRouteIsGuarded(app, router)).toThrow(/sneaky/);
  });

  it("throws when the router declared a route that never actually got registered", () => {
    const app = new Hono<AppEnv>();
    const router = new GuardedRouter(app);
    // Directly push a bogus registry entry — simulates the registry and the
    // live route table disagreeing in the other direction.
    router.registry.push({ method: "GET", path: "/ghost", guard: { public: true } });

    expect(() => assertEveryRouteIsGuarded(app, router)).toThrow(/ghost/);
  });
});

describe("route coverage on the real app", () => {
  it("every route registered on the live Hono app has a matching GuardedRouter declaration", async () => {
    const { app, router } = await buildTestApp();

    // This is the point of the whole mechanism: cross-check the *actual*
    // production route table (not a hand-picked subset) against what the
    // router declared. createApp() already calls this at construction
    // time and would have thrown before buildTestApp() returned if it
    // failed — this re-run against the same objects documents why, and
    // fails on its own if that wiring is ever weakened.
    expect(() => assertEveryRouteIsGuarded(app, router)).not.toThrow();
  });

  it("declares at least one public route and at least one scoped route", async () => {
    const { router } = await buildTestApp();

    const hasPublic = router.registry.some((r) => "public" in r.guard);
    const hasScoped = router.registry.some((r) => "scopes" in r.guard && r.guard.scopes.length > 0);

    expect(hasPublic).toBe(true);
    expect(hasScoped).toBe(true);
  });

  it("gates every /admin route behind members:admin or tokens:admin", async () => {
    const { router } = await buildTestApp();

    const adminRoutes = router.registry.filter((r) => r.path.startsWith("/admin"));
    expect(adminRoutes.length).toBeGreaterThan(0);

    for (const route of adminRoutes) {
      expect("scopes" in route.guard).toBe(true);
      if ("scopes" in route.guard) {
        const isAdminGuarded = route.guard.scopes.some(
          (s) => s === "members:admin" || s === "tokens:admin",
        );
        expect(isAdminGuarded).toBe(true);
      }
    }
  });
});

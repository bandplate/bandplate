// `middleware.ts` itself shipped untested — `guard.test.ts` covers the
// pure `guardAdminPath` decision function, but nothing exercised the
// wiring in `onRequest` that turns a "redirect" decision into an actual
// `context.redirect()` call or a "forbidden" decision into the 403
// response. Mutation testing found deleting either branch (the redirect
// at :39-41 or the 403 at :42-47) survives the whole suite — this file is
// what closes that.
//
// Round 2 adds coverage for the structural CSRF backstop `onRequest` now
// applies to every mutating (non-GET/HEAD) request to a non-`/api/*` page
// route — see the header comment in `middleware.ts`.
//
// `defineMiddleware` (astro/dist/core/middleware/index.js) is the identity
// function, so `onRequest` is callable directly with a hand-built
// `context`/`next` — no need to boot Astro's dev server or the Node
// adapter for this.
import type { MemberPrincipal } from "@bandlib/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_APP_ORIGIN = "https://bandlib.example";

const resolvePrincipalFromCookie = vi.fn();

// `astro:middleware` is a virtual module Astro's Vite plugin resolves at
// build/dev time — unavailable to plain vitest, which doesn't run through
// that pipeline. `defineMiddleware` is the identity function (see
// astro/dist/core/middleware/index.js), so mocking it as exactly that
// preserves real behavior: `onRequest` below is the actual function this
// file defines, not a stand-in.
vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: unknown) => fn,
}));
vi.mock("./server/principal.js", () => ({
  resolvePrincipalFromCookie: (...args: unknown[]) => resolvePrincipalFromCookie(...args),
}));
vi.mock("./server/app.js", () => ({
  getAuthDeps: vi.fn(async () => ({})),
  getAppDeps: vi.fn(async () => ({ config: { appOrigin: TEST_APP_ORIGIN } })),
}));

const { onRequest: rawOnRequest } = await import("./middleware.js");

// `onRequest`'s declared type is Astro's generic `MiddlewareHandler`, which
// allows a `void` return (for middlewares that only call `next()` for a
// side effect) — this one never actually returns void, it always either
// short-circuits with a `Response` or returns `next()`'s `Promise<Response>`.
// Narrowed here once so every test below can assert on `.status`/`.headers`
// without repeating a null check.
async function onRequest(
  // biome-ignore lint/suspicious/noExplicitAny: matches makeContext's minimal APIContext stand-in
  context: any,
  next: Parameters<typeof rawOnRequest>[1],
): Promise<Response> {
  const result = await rawOnRequest(context, next);
  if (!result) {
    throw new Error("onRequest returned void — expected a Response in every case tested here");
  }
  return result;
}

interface MakeContextOptions {
  cookieValue?: string;
  method?: string;
  origin?: string;
}

function makeContext(pathname: string, options: MakeContextOptions = {}) {
  const { cookieValue, method = "GET", origin } = options;
  const locals: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  if (origin !== undefined) {
    headers.origin = origin;
  }
  return {
    url: new URL(`http://localhost${pathname}`),
    request: new Request(`http://localhost${pathname}`, { method, headers }),
    cookies: {
      get: (_name: string) => (cookieValue === undefined ? undefined : { value: cookieValue }),
    },
    locals,
    redirect: (to: string, status?: number) =>
      new Response(null, { status: status ?? 302, headers: { Location: to } }),
    // biome-ignore lint/suspicious/noExplicitAny: minimal stand-in for Astro's APIContext
  } as any;
}

const nextResponse = new Response("next-called");
const next = vi.fn(async () => nextResponse);

function admin(): MemberPrincipal {
  return { kind: "member", memberId: "admin-1", role: "admin", scopes: ["members:admin"] };
}

function member(): MemberPrincipal {
  return { kind: "member", memberId: "member-1", role: "member", scopes: ["songs:read"] };
}

describe("middleware onRequest", () => {
  beforeEach(() => {
    resolvePrincipalFromCookie.mockReset();
    next.mockClear();
  });

  it("redirects an anonymous visitor away from /admin to /login (302, Location: /login)", async () => {
    resolvePrincipalFromCookie.mockResolvedValue(undefined);
    const context = makeContext("/admin");

    const response = await onRequest(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("responds 403 for a member principal without members:admin on /admin", async () => {
    resolvePrincipalFromCookie.mockResolvedValue(member());
    const context = makeContext("/admin/members");

    const response = await onRequest(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
  });

  it("calls next() and admits an admin principal on /admin", async () => {
    resolvePrincipalFromCookie.mockResolvedValue(admin());
    const context = makeContext("/admin/members");

    const response = await onRequest(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response).toBe(nextResponse);
  });

  it("calls next() unconditionally on a non-admin path, regardless of principal", async () => {
    resolvePrincipalFromCookie.mockResolvedValue(undefined);
    const context = makeContext("/login");

    const response = await onRequest(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response).toBe(nextResponse);
  });

  it("sets locals.principal to the resolved principal (undefined for anonymous)", async () => {
    resolvePrincipalFromCookie.mockResolvedValue(undefined);
    const context = makeContext("/login");
    await onRequest(context, next);
    expect(context.locals.principal).toBeUndefined();
  });

  it("sets locals.principal to the resolved member for an authenticated request", async () => {
    const m = member();
    resolvePrincipalFromCookie.mockResolvedValue(m);
    const context = makeContext("/", { cookieValue: "some-cookie-value" });
    await onRequest(context, next);
    expect(context.locals.principal).toEqual(m);
  });
});

describe("middleware onRequest — member-facing routes (/songs, /events)", () => {
  beforeEach(() => {
    resolvePrincipalFromCookie.mockReset();
    next.mockClear();
  });

  it("redirects an anonymous visitor away from /songs to /login (302, Location: /login)", async () => {
    resolvePrincipalFromCookie.mockResolvedValue(undefined);
    const response = await onRequest(makeContext("/songs"), next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("redirects an anonymous visitor away from /events/some-id to /login", async () => {
    resolvePrincipalFromCookie.mockResolvedValue(undefined);
    const response = await onRequest(makeContext("/events/some-id"), next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("calls next() and admits a plain member principal on /songs and /events", async () => {
    resolvePrincipalFromCookie.mockResolvedValue(member());

    const songsResponse = await onRequest(makeContext("/songs"), next);
    expect(songsResponse).toBe(nextResponse);

    const eventsResponse = await onRequest(makeContext("/events/some-id"), next);
    expect(eventsResponse).toBe(nextResponse);

    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe("middleware onRequest — structural CSRF backstop", () => {
  beforeEach(() => {
    resolvePrincipalFromCookie.mockReset();
    resolvePrincipalFromCookie.mockResolvedValue(undefined);
    next.mockClear();
  });

  it("rejects a mutating request to a page route with a mismatched Origin (403, next not called)", async () => {
    const context = makeContext("/login", { method: "POST", origin: "https://evil.example" });

    const response = await onRequest(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
  });

  it("rejects a mutating request to a page route with no Origin header at all", async () => {
    const context = makeContext("/login", { method: "POST" });

    const response = await onRequest(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
  });

  it("admits a mutating request to a page route with the correct Origin", async () => {
    const context = makeContext("/login", { method: "POST", origin: TEST_APP_ORIGIN });

    const response = await onRequest(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response).toBe(nextResponse);
  });

  it("does not check Origin on a non-mutating (GET) request", async () => {
    const context = makeContext("/login", { method: "GET", origin: "https://evil.example" });

    const response = await onRequest(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response).toBe(nextResponse);
  });

  it("does not apply this check to /api/* — that's the Hono app's own originCheckMiddleware's job, which (unlike this cookie-only check) exempts service-token requests", async () => {
    const context = makeContext("/api/admin/members", { method: "POST" });

    const response = await onRequest(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response).toBe(nextResponse);
  });
});

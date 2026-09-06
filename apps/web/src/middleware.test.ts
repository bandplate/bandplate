// `middleware.ts` itself shipped untested — `guard.test.ts` covers the
// pure `guardAdminPath` decision function, but nothing exercised the
// wiring in `onRequest` that turns a "redirect" decision into an actual
// `context.redirect()` call or a "forbidden" decision into the 403
// response. Mutation testing found deleting either branch (the redirect
// at :39-41 or the 403 at :42-47) survives the whole suite — this file is
// what closes that.
//
// `defineMiddleware` (astro/dist/core/middleware/index.js) is the identity
// function, so `onRequest` is callable directly with a hand-built
// `context`/`next` — no need to boot Astro's dev server or the Node
// adapter for this.
import type { MemberPrincipal } from "@bandlib/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function makeContext(pathname: string, cookieValue?: string) {
  const locals: Record<string, unknown> = {};
  return {
    url: new URL(`http://localhost${pathname}`),
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
    const context = makeContext("/", "some-cookie-value");
    await onRequest(context, next);
    expect(context.locals.principal).toEqual(m);
  });
});

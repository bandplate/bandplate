// Principal resolution — step 1 of the middleware chain (see the brief:
// "1. Principal resolution", before origin check, before scope checks).
// `Authorization: Bearer bpk_...` resolves a service principal;
// `bp_session` resolves a member principal; neither leaves the caller
// anonymous. When both are present, the bearer wins and the cookie is
// ignored entirely — never both.
import type { AuthDeps } from "@bandplate/core";
import { resolveServiceToken, resolveSession } from "@bandplate/core";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME } from "../cookies.js";
import type { AppEnv } from "../types.js";

const BEARER_PREFIX = "Bearer ";

export function principalMiddleware(auth: AuthDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const authHeader = c.req.header("authorization");

    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const rawBearer = authHeader.slice(BEARER_PREFIX.length);
      c.set("principal", await resolveServiceToken(auth, rawBearer));
      await next();
      return;
    }

    const cookie = getCookie(c, SESSION_COOKIE_NAME);
    if (cookie) {
      c.set("principal", await resolveSession(auth, cookie));
      await next();
      return;
    }

    c.set("principal", undefined);
    await next();
  };
}

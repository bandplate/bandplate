// Origin check — step 2 of the middleware chain, after principal
// resolution (it needs to know whether this is a service-token request to
// grant the exemption) and before any `requireScopes` check.
import type { MiddlewareHandler } from "hono";
import { errorResponse } from "../errors.js";
import type { AppEnv } from "../types.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Requires `Origin` to match `appOrigin` on every mutating request, except
 * bearer-token requests — bearer auth carries no ambient authority (no
 * cookies sent automatically by a browser), so there is nothing for a
 * cross-site request to ride along on. The exemption is keyed on the
 * PRESENCE of an `Authorization: Bearer ...` header, not on whether it
 * happened to resolve to a valid service principal — a missing/malformed/
 * unknown/revoked token must still reach the route's own `401` (see the
 * ingest contract v1 §2/§9's "Ingest requests are exempt from the browser
 * Origin/CSRF check"), not get shadowed by an unrelated `403
 * forbidden_origin` from this middleware running first, ahead of that
 * check, just because no `Origin` header happens to be present either
 * (exactly the shape of a real ingest request: a script, not a browser).
 */
export function originCheckMiddleware(appOrigin: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    if (c.req.header("authorization")?.startsWith("Bearer ")) {
      await next();
      return;
    }

    // The entire ingest surface (contract v1 §2: "Ingest requests are
    // exempt from the browser Origin/CSRF check — they carry no cookies
    // and no ambient authority") is exempt outright, even for a request
    // with NO `Authorization` header at all — that's simply an
    // unauthenticated ingest request, which every ingest route already
    // 401s on its own via `requireServiceScopes`. Without this, such a
    // request would get shadowed by this middleware's unrelated `403
    // forbidden_origin` first, since it has no session cookie either.
    if (c.req.path.startsWith("/ingest/v1/")) {
      await next();
      return;
    }

    const origin = c.req.header("origin");
    if (origin !== appOrigin) {
      return errorResponse(c, 403, "forbidden_origin", "Origin not allowed.");
    }

    await next();
  };
}

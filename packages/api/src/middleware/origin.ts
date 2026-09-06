// Origin check — step 2 of the middleware chain, after principal
// resolution (it needs to know whether this is a service-token request to
// grant the exemption) and before any `requireScopes` check.
import type { MiddlewareHandler } from "hono";
import { errorResponse } from "../errors.js";
import type { AppEnv } from "../types.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Requires `Origin` to match `appOrigin` on every mutating request, except
 * service-token requests — bearer auth carries no ambient authority (no
 * cookies sent automatically by a browser), so there is nothing for a
 * cross-site request to ride along on.
 */
export function originCheckMiddleware(appOrigin: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    if (c.get("principal")?.kind === "service") {
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

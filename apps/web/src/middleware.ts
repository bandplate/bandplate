// Resolves the session cookie to a principal on every request and puts it
// on `Astro.locals` (typed in `env.d.ts`) — anonymous requests get
// `undefined`, not an error. Also guards `/admin/*`: anonymous visitors are
// redirected to `/login`, a signed-in member without the `members:admin`
// scope gets a 403, an admin is admitted. See `server/guard.ts` for the
// (pure, unit-tested) decision logic.
//
// Also the **structural CSRF backstop** for every hand-written page route
// (`.astro` frontmatter, or a bespoke `.ts` endpoint) under `src/pages/`
// — see task-4-report.md "Fix round 2". Before this, `server/csrf.ts#isSameOrigin`
// was called by convention: all ten current mutating pages call it, but
// nothing made an eleventh page do the same — no lint rule, no test, no
// compiler error, just a developer remembering a line. This middleware
// runs before every page handler and independently rejects any mutating
// (non-GET/HEAD) request whose `Origin` doesn't match, so a page that
// forgets its own check is still covered, and a brand-new page can't ship
// unguarded even by accident. The ten existing pages' own `isSameOrigin`
// calls are left exactly as they were (redundant with this, not replaced
// by it) — see the task-4 handoff's "do not disturb" list.
import { defineMiddleware } from "astro:middleware";
import { getAppDeps, getAuthDeps } from "./server/app.js";
import { SESSION_COOKIE_NAME } from "./server/cookies.js";
import { isSameOrigin } from "./server/csrf.js";
import { guardAdminPath, guardMemberPath, normalizePathname } from "./server/guard.js";
import { resolvePrincipalFromCookie } from "./server/principal.js";

const FORBIDDEN_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Forbidden — bandlib</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4efe2; color: #2f0c02; margin: 0; padding: 2.5rem 1.5rem; }
  @media (prefers-color-scheme: dark) { body { background: #2f0c02; color: #f4efe2; } a { color: #f4efe2; } }
  main { max-width: 32rem; margin: 0 auto; }
  a { color: inherit; }
</style>
</head>
<body>
  <main>
    <h1>You don't have access to this page</h1>
    <p>Admin sections need an admin account. If you think this is wrong, ask whoever administers your bandlib for admin access.</p>
    <p><a href="/">Back to bandlib</a></p>
  </main>
</body>
</html>`;

const ORIGIN_ERROR_TEXT =
  "Something about that request looked wrong. Reload the page and try again.";

/** Mirrors `packages/api`'s `originCheckMiddleware` `MUTATING_METHODS`. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `/api/*` is excluded: it's a single catch-all (`pages/api/[...path].ts`)
 * that delegates to `@bandlib/api`'s own Hono app, which runs its own
 * `originCheckMiddleware` — and that one additionally exempts
 * service-token (bearer) requests, which this cookie-only check can't
 * evaluate (it never looks at `Authorization`). Re-checking here would
 * reject legitimate service-token API calls that carry no `Origin` header
 * at all. A future hand-written `.ts` endpoint anywhere else under
 * `src/pages/` is NOT excluded and gets the same check as an `.astro` page.
 *
 * Normalized the same way as `guardAdminPath`/`guardMemberPath`'s checks
 * next to this one (`server/guard.ts#normalizePathname`, reused rather
 * than reimplemented) — a bare string check here would be safe in the
 * current direction (a `//api/...` request would just fail this exemption
 * and get the origin check applied, not skip it), but the asymmetry
 * invites the next reader to assume normalization is applied everywhere
 * page-routing decisions are made, when it wasn't. See task-5-report.md
 * "Fix round 3" #3.
 */
function isApiRoute(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === "/api" || path.startsWith("/api/");
}

export const onRequest = defineMiddleware(async (context, next) => {
  const [authDeps, appDeps] = await Promise.all([getAuthDeps(), getAppDeps()]);
  const cookieValue = context.cookies.get(SESSION_COOKIE_NAME)?.value;
  const principal = await resolvePrincipalFromCookie(authDeps, cookieValue);
  context.locals.principal = principal;

  if (
    MUTATING_METHODS.has(context.request.method) &&
    !isApiRoute(context.url.pathname) &&
    !isSameOrigin(context.request, appDeps.config.appOrigin)
  ) {
    return new Response(ORIGIN_ERROR_TEXT, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const adminDecision = guardAdminPath(context.url.pathname, principal);
  if (adminDecision.kind === "redirect") {
    return context.redirect(adminDecision.to);
  }
  if (adminDecision.kind === "forbidden") {
    return new Response(FORBIDDEN_HTML, {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // The song library / event archive (Task 5) — every other route a signed-in
  // member reaches: no extra scope beyond "signed in" (see guard.ts).
  const memberDecision = guardMemberPath(context.url.pathname, principal);
  if (memberDecision.kind === "redirect") {
    return context.redirect(memberDecision.to);
  }

  return next();
});

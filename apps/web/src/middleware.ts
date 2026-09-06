// Resolves the session cookie to a principal on every request and puts it
// on `Astro.locals` (typed in `env.d.ts`) — anonymous requests get
// `undefined`, not an error. Also guards `/admin/*`: anonymous visitors are
// redirected to `/login`, a signed-in member without the `members:admin`
// scope gets a 403, an admin is admitted. See `server/guard.ts` for the
// (pure, unit-tested) decision logic.
import { defineMiddleware } from "astro:middleware";
import { getAuthDeps } from "./server/app.js";
import { SESSION_COOKIE_NAME } from "./server/cookies.js";
import { guardAdminPath } from "./server/guard.js";
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

export const onRequest = defineMiddleware(async (context, next) => {
  const authDeps = await getAuthDeps();
  const cookieValue = context.cookies.get(SESSION_COOKIE_NAME)?.value;
  const principal = await resolvePrincipalFromCookie(authDeps, cookieValue);
  context.locals.principal = principal;

  const decision = guardAdminPath(context.url.pathname, principal);
  if (decision.kind === "redirect") {
    return context.redirect(decision.to);
  }
  if (decision.kind === "forbidden") {
    return new Response(FORBIDDEN_HTML, {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return next();
});

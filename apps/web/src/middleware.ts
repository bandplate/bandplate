import { defineMiddleware } from "astro:middleware";
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
import { describeError, logError } from "@bandplate/core";
import { type Locale, negotiateLocale } from "@bandplate/i18n";
import { getAppDeps, getAuthDeps, getWebConfig, initWorkersRuntime } from "./server/app.js";
import { SESSION_COOKIE_NAME, readLocaleCookie, setLocaleCookie } from "./server/cookies.js";
import { isSameOrigin } from "./server/csrf.js";
import { guardAdminPath, guardMemberPath, normalizePathname } from "./server/guard.js";
import { resolvePrincipalFromCookie } from "./server/principal.js";

const forbiddenHtml = (locale: Locale) => `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><title>Forbidden | bandplate</title>
<style>
  /* Hardcoded rather than tokenised on purpose: this page is a string in
     the middleware and never loads a stylesheet. Values are Dubplate bone/ink
     and lacquer/bone — keep them in step with tokens/dubplate.css by hand. */
  body { font-family: "Chivo", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f2e8d8; color: #150c07; margin: 0; padding: 2.5rem 1.5rem; }
  @media (prefers-color-scheme: dark) { body { background: #150c07; color: #f2e8d8; } a { color: #f2e8d8; } }
  main { max-width: 32rem; margin: 0 auto; }
  a { color: inherit; }
</style>
</head>
<body>
  <main>
    <h1>You don't have access to this page</h1>
    <p>Admin sections need an admin account. If you think this is wrong, ask whoever administers your bandplate for admin access.</p>
    <p><a href="/">Back to bandplate</a></p>
  </main>
</body>
</html>`;

const ORIGIN_ERROR_TEXT =
  "Something about that request looked wrong. Reload the page and try again.";

/** Mirrors `packages/api`'s `originCheckMiddleware` `MUTATING_METHODS`. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `/api/*` is excluded: it's a single catch-all (`pages/api/[...path].ts`)
 * that delegates to `@bandplate/api`'s own Hono app, which runs its own
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
  // Workers profile only: `context.locals.runtime` is set by
  // `@astrojs/cloudflare`'s own middleware, which runs before this one.
  // `initWorkersRuntime` is a no-op after its first call (see
  // `server/app.ts`'s doc comment) — this runs on every request, but only
  // the first one in a given isolate actually builds anything. The Node
  // adapter never sets `locals.runtime`, so this branch never runs there
  // and `getAuthDeps`/`getAppDeps` fall through to the unchanged
  // Node/libSQL runtime exactly as before.
  if (context.locals.runtime) {
    initWorkersRuntime(context.locals.runtime.env);
  }
  const [authDeps, appDeps, webConfig] = await Promise.all([
    getAuthDeps(),
    getAppDeps(),
    getWebConfig(),
  ]);
  const cookieValue = context.cookies.get(SESSION_COOKIE_NAME)?.value;
  const principal = await resolvePrincipalFromCookie(authDeps, cookieValue);
  context.locals.principal = principal;

  // --- Which language this request is rendered in -------------------------
  //
  // In order: the member's own setting, then the cookie recording an earlier
  // choice, then what the browser asked for, then this installation's own
  // language (`BANDPLATE_DEFAULT_LOCALE`, English unless set). Each step is a
  // stronger statement of intent than the one after it, and only the first is
  // a decision the member made INSIDE the app.
  //
  // The configured default sits LAST on purpose. A Czech deployment wants
  // Czech for the visitor whose browser asks for something nobody here
  // speaks — it does not want to overrule a browser that asked for English,
  // which is a real statement about the person reading.
  //
  // The member's locale is read fresh on every request — `resolveSession`
  // already loads the row — so changing it takes effect immediately on every
  // device that member is signed in on, with no session revocation.
  const cookieLocale = readLocaleCookie(context.cookies);
  const locale: Locale =
    principal?.locale ??
    cookieLocale ??
    negotiateLocale(context.request.headers.get("accept-language"), webConfig.defaultLocale);
  context.locals.locale = locale;

  // Keep the cookie in step with the member, so the NEXT signed-out page they
  // see — the sign-in screen after a logout, or on a device where the session
  // has expired — is in the language they chose rather than whatever their
  // browser happens to ask for. Only written when it actually differs, so this
  // is not a Set-Cookie on every request.
  if (principal && cookieLocale !== principal.locale) {
    setLocaleCookie(context.cookies, principal.locale, {
      cookieSecure: appDeps.config.cookieSecure,
    });
  }

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
    return new Response(forbiddenHtml(locale), {
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

  // Any page handler (`.astro` frontmatter, a bespoke `.ts` endpoint under
  // `src/pages/`) that throws instead of returning a Response ends up here.
  // Logged once, structured, then rethrown unchanged — this middleware
  // does not turn it into a Response itself, so Astro's own dev/production
  // error handling still runs exactly as before; only what reaches the
  // console differs.
  //
  // A thrown `Response` is not a failure: Astro's own `Astro.redirect`/
  // `Astro.rewrite` and a page's own control flow can throw one as a
  // legitimate way to short-circuit rendering, not an error worth an
  // operator's attention. Rethrown untouched, before it's ever treated as
  // an `err` to log.
  let response: Response;
  try {
    response = await next();
  } catch (err) {
    if (err instanceof Response) {
      throw err;
    }
    const { message, stack } = describeError(err);
    logError({ kind: "page", route: context.url.pathname, message, stack });
    throw err;
  }

  // What this response depended on, for any cache between here and the reader.
  //
  // Nothing in front of the app today caches HTML — the only `Cache-Control`
  // on any page is `/login/[token]`'s `no-store` — so this changes nothing
  // now. It is here because the page whose language is negotiated rather than
  // chosen is `/login`, the ONE page a cache would ever be allowed to hold: it
  // is the same for every anonymous visitor except for the language, and
  // serving a Czech sign-in screen to an English visitor (or the reverse) is
  // exactly the bug a missing `Vary` produces. Cheaper to state the dependency
  // now than to debug it after somebody puts a CDN in front.
  //
  // `Cookie` as well as `Accept-Language`, because `bp_locale` outranks the
  // header — and because every signed-in page already varies by the session
  // cookie anyway.
  response.headers.append("Vary", "Accept-Language, Cookie");
  return response;
});

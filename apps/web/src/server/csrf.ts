// Origin check for the Astro pages' own POST handlers — the same check
// `packages/api`'s `originCheckMiddleware` applies to the JSON API,
// reapplied here because these pages call `@bandplate/core` directly instead
// of going through that Hono middleware chain. Browsers send `Origin` on
// every POST/PUT/PATCH/DELETE, cross-site or not (this is what makes the
// check work as CSRF protection for a plain HTML form submission, not just
// for `fetch`).
export function isSameOrigin(request: Request, appOrigin: string): boolean {
  const origin = request.headers.get("origin");
  return origin === appOrigin;
}

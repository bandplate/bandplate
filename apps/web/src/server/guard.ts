// Page-route guard decisions — pure functions so they're testable without
// booting Astro. Reuses `hasAllScopes` (the one authorization check, per
// `@bandplate/core`) rather than branching on `principal.role` — a member
// principal simply doesn't carry the `members:admin` scope, so this is the
// same check the `/admin/*` API routes already make, applied one layer up
// (before rendering) so the page itself doesn't fetch anything the member
// isn't allowed to see.
import type { Principal } from "@bandplate/core";
import { hasAllScopes } from "@bandplate/core";

export type GuardDecision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" };

const ADMIN_SCOPE = "members:admin" as const;

// Collapses repeated leading (or embedded) slashes so a request path can't
// dodge either guard below by never landing on any prefix they check.
// `"//takes/x"` was the concrete exploit while `PUBLIC_PATH_PREFIXES`
// still contained `"/"` (Task 5's home placeholder — see that entry's own
// history below): `"/" + "/"` is `"//"`, so `isPublicPath` matched
// `pathname.startsWith("//")` for ANY path, classifying every
// `//`-prefixed request as public and skipping the member guard entirely.
// `"/"` is no longer on the list (Task 6's real home needs a principal),
// but the normalization stays load-bearing for every prefix still on it —
// `"//login/x"` needs the same collapse to match `"/login"`. The same
// shape of bug lurks the other way for `isAdminPath`: `"/admin"`'s
// own prefix check (`startsWith("/admin/")`) does NOT match
// `"//admin/members"`, so an unnormalized pathname would let a signed-in
// non-admin member's `//admin/...` request skip the scope check too, even
// though Astro's own router still resolves the double-slash path to the
// same page a single slash would. Normalizing once, here, closes both
// holes the same way rather than patching `isPublicPath` alone.
export function normalizePathname(pathname: string): string {
  return pathname.replace(/\/{2,}/g, "/");
}

export function isAdminPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === "/admin" || path.startsWith("/admin/");
}

export function guardAdminPath(pathname: string, principal: Principal | undefined): GuardDecision {
  if (!isAdminPath(pathname)) {
    return { kind: "allow" };
  }
  if (!principal) {
    return { kind: "redirect", to: "/login" };
  }
  if (principal.kind !== "member" || !hasAllScopes(principal, [ADMIN_SCOPE])) {
    return { kind: "forbidden" };
  }
  return { kind: "allow" };
}

// The member-facing browsing surface — the song library and event archive
// (Task 5), and everything else a signed-in member reaches. Unlike
// `/admin/*`, there is no extra scope check beyond "signed in":
// `scopesForRole` (in `@bandplate/core`) grants every member `songs:read` and
// `events:read` regardless of role, and a principal resolved from the
// session cookie is always a `MemberPrincipal` (never a `ServicePrincipal` —
// those only ever come from a bearer token), so `hasAllScopes` here would
// only ever reject an already-impossible case. The real 401-equivalent this
// guards against is simple: no `principal` at all.
//
// Deny-by-default: every path needs a signed-in principal UNLESS it's on
// this explicit PUBLIC allowlist. This used to be inverted — an allowlist of
// member paths (`/songs`, `/events`, `/search`, `/me`) that every new
// member-facing route had to remember to join, or it shipped unguarded.
// `/takes/[id]` (Task 6, already linked from `TakeRow.astro`) is exactly
// that trap: nothing today adds it to the old list. Deny-by-default closes
// it structurally — the same "developer remembers a line" failure the CSRF
// backstop in `middleware.ts` was added to eliminate, applied here too. A
// brand-new route needs no registration to be guarded; it only needs
// registering to be made PUBLIC, which is the rarer, more deliberate case.
const PUBLIC_PATH_PREFIXES = [
  // "/" (home) is deliberately NOT here, unlike Task 5's placeholder: Task
  // 6's real home reads the signed-in member's own favorites and unvoted
  // takes, so it needs a principal like every other member-facing page —
  // see task-6-report.md.
  "/login", // the sign-in form and /login/[token]
  "/setup", // first-admin bootstrap — self-guards via isBootstrapAvailable
  "/logout",
  "/api", // its own bearer/service-token auth, not the cookie session
  "/_astro", // built client assets (JS/CSS chunks) — never reached in
  // production (the Node adapter's static handler serves these before the
  // app/middleware ever sees the request), but `astro dev` does route
  // asset requests through this middleware, so they're allowlisted here
  // too rather than relying on that difference.
] as const;

export function isPublicPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function guardMemberPath(pathname: string, principal: Principal | undefined): GuardDecision {
  if (isPublicPath(pathname)) {
    return { kind: "allow" };
  }
  if (!principal) {
    return { kind: "redirect", to: "/login" };
  }
  return { kind: "allow" };
}

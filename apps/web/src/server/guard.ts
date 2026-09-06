// Page-route guard decisions — pure functions so they're testable without
// booting Astro. Reuses `hasAllScopes` (the one authorization check, per
// `@bandlib/core`) rather than branching on `principal.role` — a member
// principal simply doesn't carry the `members:admin` scope, so this is the
// same check the `/admin/*` API routes already make, applied one layer up
// (before rendering) so the page itself doesn't fetch anything the member
// isn't allowed to see.
import type { Principal } from "@bandlib/core";
import { hasAllScopes } from "@bandlib/core";

export type GuardDecision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" };

const ADMIN_SCOPE = "members:admin" as const;

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
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
// (Task 5). Unlike `/admin/*`, there is no extra scope check beyond "signed
// in": `scopesForRole` (in `@bandlib/core`) grants every member `songs:read`
// and `events:read` regardless of role, and a principal resolved from the
// session cookie is always a `MemberPrincipal` (never a `ServicePrincipal` —
// those only ever come from a bearer token), so `hasAllScopes` here would
// only ever reject an already-impossible case. The real 401-equivalent this
// guards against is simple: no `principal` at all.
const MEMBER_PATH_PREFIXES = ["/songs", "/events", "/search", "/me"] as const;

export function isMemberPath(pathname: string): boolean {
  return MEMBER_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function guardMemberPath(pathname: string, principal: Principal | undefined): GuardDecision {
  if (!isMemberPath(pathname)) {
    return { kind: "allow" };
  }
  if (!principal) {
    return { kind: "redirect", to: "/login" };
  }
  return { kind: "allow" };
}

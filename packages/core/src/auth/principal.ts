import type { MemberRole, Scope } from "./scopes.js";

export interface MemberPrincipal {
  kind: "member";
  memberId: string;
  role: MemberRole;
  scopes: Scope[];
}

export interface ServicePrincipal {
  kind: "service";
  tokenId: string;
  scopes: Scope[];
}

/** A resolved caller: either a logged-in member or a service token. Never both. */
export type Principal = MemberPrincipal | ServicePrincipal;

/**
 * The single authorization check in the codebase. Every route guard, in
 * every layer, must call this (directly or via the API's `requireScopes`
 * wrapper) rather than inspecting `principal.role` or `principal.kind`
 * itself — that would be a second, parallel authorization system.
 */
export function hasAllScopes(
  principal: Principal | undefined,
  required: readonly Scope[],
): boolean {
  if (!principal) {
    return false;
  }
  return required.every((scope) => principal.scopes.includes(scope));
}

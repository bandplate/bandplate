import type { Locale } from "@bandplate/i18n";
import type { MemberRole, Scope } from "./scopes.js";

export interface MemberPrincipal {
  kind: "member";
  memberId: string;
  role: MemberRole;
  scopes: Scope[];
  /**
   * Which language to render for this member.
   *
   * Presentation, NOT authorization — `hasAllScopes` remains the single check
   * and does not look at this. It rides on the principal because
   * `resolveSession` already loads the full member row to check
   * `status !== "disabled"`, so carrying the locale costs zero extra queries
   * and puts it wherever a request is already resolved: Astro pages via
   * `Astro.locals`, and Hono routes via the same shared resolution path.
   *
   * `ServicePrincipal` has none. A service token has no member and therefore
   * no language; anything it renders is a machine contract and stays English.
   */
  locale: Locale;
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

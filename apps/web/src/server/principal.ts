// Resolves the `bp_session` cookie to a principal — a thin wrapper around
// `@bandplate/core`'s `resolveSession` so it's trivially testable without
// needing Astro's cookie jar or the `astro:middleware` virtual module.
import type { AuthDeps, MemberPrincipal } from "@bandplate/core";
import { resolveSession } from "@bandplate/core";

export async function resolvePrincipalFromCookie(
  authDeps: AuthDeps,
  cookieValue: string | undefined,
): Promise<MemberPrincipal | undefined> {
  if (!cookieValue) {
    return undefined;
  }
  return resolveSession(authDeps, cookieValue);
}

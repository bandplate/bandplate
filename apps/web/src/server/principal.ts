// Resolves the `bl_session` cookie to a principal — a thin wrapper around
// `@bandlib/core`'s `resolveSession` so it's trivially testable without
// needing Astro's cookie jar or the `astro:middleware` virtual module.
import type { AuthDeps, MemberPrincipal } from "@bandlib/core";
import { resolveSession } from "@bandlib/core";

export async function resolvePrincipalFromCookie(
  authDeps: AuthDeps,
  cookieValue: string | undefined,
): Promise<MemberPrincipal | undefined> {
  if (!cookieValue) {
    return undefined;
  }
  return resolveSession(authDeps, cookieValue);
}

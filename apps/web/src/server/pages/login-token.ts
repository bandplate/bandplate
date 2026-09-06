// `/login/[token]` page logic. **GET must mutate nothing** — `peekView`
// calls `peekLoginToken`, which only reads. `consume` calls
// `consumeLoginToken`, the single-use guarded mutation, and is only ever
// invoked from the POST handler. This split (peek vs. consume, in
// different functions, calling different core services) is what makes a
// mail-provider link-prefetch GET harmless: there is no code path from a
// GET request to `consumeLoginToken` at all.
import type { AuthDeps, MemberPrincipal } from "@bandlib/core";
import { consumeLoginToken, peekLoginToken } from "@bandlib/core";

export type LoginTokenView = { kind: "valid"; displayName?: string } | { kind: "invalid" };

export async function peekView(auth: AuthDeps, token: string): Promise<LoginTokenView> {
  const result = await peekLoginToken(auth, token);
  if (!result.valid) {
    return { kind: "invalid" };
  }
  return { kind: "valid", displayName: result.displayName };
}

export type ConsumeResult =
  | { ok: true; sessionToken: string; principal: MemberPrincipal }
  | { ok: false };

export async function consume(
  auth: AuthDeps,
  token: string,
  userAgent: string | null,
): Promise<ConsumeResult> {
  const result = await consumeLoginToken(auth, token, { userAgent });
  if (!result.ok || !result.sessionToken || !result.principal) {
    return { ok: false };
  }
  return { ok: true, sessionToken: result.sessionToken, principal: result.principal };
}

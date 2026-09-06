// `/admin/tokens` page logic — mirrors
// `packages/api/src/routes/admin-tokens.ts`. The raw secret is returned
// exactly once, from `createToken`, and never persisted or logged (see
// `createServiceToken` in `@bandlib/core`) — the page that renders it must
// not put it anywhere that survives a redirect (query string, a cookie,
// server logs), so `createToken`'s result is rendered directly by the POST
// handler rather than round-tripped through a redirect.
import type { AuthDeps, Scope } from "@bandlib/core";
import { createServiceToken, isScope } from "@bandlib/core";
import type { Db } from "@bandlib/db";
import { serviceTokensRepo } from "@bandlib/db";
import { z } from "zod";

type ServiceToken = serviceTokensRepo.ServiceToken;
export type PublicServiceToken = Omit<ServiceToken, "tokenHash">;

function toPublic(token: ServiceToken): PublicServiceToken {
  const { tokenHash: _tokenHash, ...rest } = token;
  return rest;
}

export async function listTokens(db: Db): Promise<PublicServiceToken[]> {
  const tokens = await serviceTokensRepo.list(db);
  return tokens.map(toPublic);
}

export async function getToken(db: Db, id: string): Promise<PublicServiceToken | undefined> {
  const token = await serviceTokensRepo.getById(db, id);
  return token ? toPublic(token) : undefined;
}

function parseScopes(formData: FormData): Scope[] | undefined {
  const values = formData.getAll("scopes").map(String);
  if (values.length === 0 || !values.every(isScope)) {
    return undefined;
  }
  return values as Scope[];
}

const labelSchema = z.string().trim().min(1, "Enter a label.").max(200);

export type CreateTokenResult =
  | { kind: "ok"; token: PublicServiceToken; rawToken: string }
  | { kind: "invalid"; error: string };

export async function createToken(auth: AuthDeps, formData: FormData): Promise<CreateTokenResult> {
  const labelParsed = labelSchema.safeParse(formData.get("label"));
  const scopes = parseScopes(formData);
  if (!labelParsed.success) {
    return { kind: "invalid", error: labelParsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (!scopes) {
    return { kind: "invalid", error: "Choose at least one scope." };
  }

  const created = await createServiceToken(auth, { label: labelParsed.data, scopes });
  return {
    kind: "ok",
    token: {
      id: created.id,
      label: created.label,
      scopes: created.scopes,
      createdAt: created.createdAt,
      lastUsedAt: null,
      revokedAt: null,
    },
    rawToken: created.rawToken,
  };
}

export type UpdateTokenScopesResult = { kind: "ok" } | { kind: "not_found" } | { kind: "invalid" };

export async function updateTokenScopes(
  db: Db,
  id: string,
  formData: FormData,
): Promise<UpdateTokenScopesResult> {
  const scopes = parseScopes(formData);
  if (!scopes) {
    return { kind: "invalid" };
  }
  const existing = await serviceTokensRepo.getById(db, id);
  if (!existing) {
    return { kind: "not_found" };
  }
  await serviceTokensRepo.setScopes(db, id, scopes);
  return { kind: "ok" };
}

export type RevokeTokenResult = { kind: "ok" } | { kind: "not_found" };

export async function revokeToken(db: Db, id: string, now: number): Promise<RevokeTokenResult> {
  const existing = await serviceTokensRepo.getById(db, id);
  if (!existing) {
    return { kind: "not_found" };
  }
  await serviceTokensRepo.revoke(db, id, now);
  return { kind: "ok" };
}

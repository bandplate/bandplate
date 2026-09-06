// Auth domain services — orchestrate the `members`/`login_tokens`/
// `auth_sessions`/`service_tokens` repos from `@bandlib/db` behind the
// behaviors the HTTP layer needs. No `node:*` imports; Web Crypto only.
import {
  type Db,
  authSessionsRepo,
  loginTokensRepo,
  membersRepo,
  serviceTokensRepo,
} from "@bandlib/db";
import type { MemberPrincipal, MemberRole, Scope, ServicePrincipal } from "../auth/index.js";
import { scopesForRole } from "../auth/index.js";
import { generateToken, hashToken, timingSafeEqualHex } from "../crypto.js";
import type { Clock, Mailer } from "../ports/index.js";
import { slugify } from "../text.js";

export const DEFAULT_LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 365 days
export const DEFAULT_SESSION_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
/**
 * Floor `requestLogin` clamps its total wall-clock time to, regardless of
 * which branch ran. A real SMTP mailer costs a round trip (100ms-1000ms)
 * for a whitelisted address, while an unknown/disabled address returns
 * after one indexed SELECT — a difference on the order of milliseconds vs.
 * hundreds of milliseconds, remotely measurable. 300ms comfortably covers a
 * typical SMTP round trip without making every login request feel slow.
 */
export const DEFAULT_LOGIN_TIMING_FLOOR_MS = 300;

const SERVICE_TOKEN_PREFIX = "blk_";
const UUID_LENGTH = 36;

/**
 * A wait primitive, injected so `requestLogin`'s timing clamp can be
 * exercised in tests without an actual wall-clock sleep: tests supply a
 * fake that records the requested duration and resolves immediately,
 * production uses `defaultSleep` (real `setTimeout`). Deliberately not
 * `Clock`-based — `Clock.now()` is for reading time deterministically, not
 * for suspending execution, and a fake clock that doesn't auto-advance
 * would make a `Clock`-driven wait resolve instantly for the wrong reason.
 */
export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface AuthDeps {
  db: Db;
  mailer: Mailer;
  clock: Clock;
  /** The operator-configured `BANDLIB_BOOTSTRAP_TOKEN` value. Required by `bootstrapAdmin` only. */
  bootstrapToken?: string;
  loginTokenTtlMs?: number;
  sessionTtlMs?: number;
  sessionRefreshThresholdMs?: number;
  /** See `DEFAULT_LOGIN_TIMING_FLOOR_MS`. */
  loginTimingFloorMs?: number;
  /** See the `Sleep` doc comment. Defaults to a real `setTimeout`-based wait. */
  sleep?: Sleep;
}

function sessionTtl(deps: AuthDeps): number {
  return deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
}

function principalForMember(memberId: string, role: MemberRole): MemberPrincipal {
  return { kind: "member", memberId, role, scopes: scopesForRole(role) };
}

// ---------------------------------------------------------------------------
// requestLogin
// ---------------------------------------------------------------------------

export interface RequestLoginMeta {
  requestedIp?: string | null;
  /** Builds the emailed URL from the raw (never-persisted) token. */
  buildLoginUrl: (rawToken: string) => string;
}

/**
 * Request a login link for `email`. Always resolves the same way (void) for
 * an unknown address, a disabled member, and a whitelisted active/invited
 * one — `members` is the whitelist, and a distinguishable outcome here would
 * turn this into an account-enumeration oracle. Callers (the HTTP route)
 * must respond identically regardless of what happened inside; returning
 * `void` makes that the only option rather than a discipline problem.
 *
 * Status and body alone aren't enough, though: a real SMTP mailer costs a
 * round trip for a whitelisted address but not for an unknown/disabled one,
 * and that gap is remotely measurable even with an identical response. This
 * clamps total wall-clock time to `loginTimingFloorMs` (default
 * `DEFAULT_LOGIN_TIMING_FLOOR_MS`) regardless of which branch ran, measured
 * via the injected `Clock` (never `Date.now()`, so tests can control it) and
 * enforced via the injected `sleep` primitive (never a bare `setTimeout`
 * call inline, so tests can fake the wait without actually blocking).
 */
export async function requestLogin(
  deps: AuthDeps,
  email: string,
  meta: RequestLoginMeta,
): Promise<void> {
  const start = deps.clock.now();
  try {
    const member = await membersRepo.getByEmail(deps.db, email);

    if (!member || member.status === "disabled") {
      return;
    }

    const now = deps.clock.now();
    const rawToken = generateToken();
    const tokenHash = await hashToken(rawToken);
    const expiresAt = now + (deps.loginTokenTtlMs ?? DEFAULT_LOGIN_TOKEN_TTL_MS);

    await loginTokensRepo.create(deps.db, {
      memberId: member.id,
      tokenHash,
      expiresAt,
      requestedIp: meta.requestedIp ?? null,
      createdAt: now,
    });

    await deps.mailer.sendLoginLink(member.email, meta.buildLoginUrl(rawToken), {
      displayName: member.displayName,
      expiresAt,
    });
  } finally {
    const floorMs = deps.loginTimingFloorMs ?? DEFAULT_LOGIN_TIMING_FLOOR_MS;
    const elapsed = deps.clock.now() - start;
    const remaining = floorMs - elapsed;
    if (remaining > 0) {
      await (deps.sleep ?? defaultSleep)(remaining);
    }
  }
}

// ---------------------------------------------------------------------------
// peekLoginToken
// ---------------------------------------------------------------------------

export interface PeekLoginTokenResult {
  valid: boolean;
  displayName?: string;
}

/**
 * Read-only validity check — never mutates `login_tokens` or anything else.
 * Mail providers and AV scanners prefetch links to build previews; a GET
 * that consumed the token would break logins non-deterministically
 * depending on each member's mail provider.
 */
export async function peekLoginToken(
  deps: AuthDeps,
  rawToken: string,
): Promise<PeekLoginTokenResult> {
  const tokenHash = await hashToken(rawToken);
  const token = await loginTokensRepo.getByHash(deps.db, tokenHash);
  const now = deps.clock.now();

  if (!token || token.usedAt !== null || token.expiresAt <= now) {
    return { valid: false };
  }

  const member = await membersRepo.getById(deps.db, token.memberId);
  if (!member || member.status === "disabled") {
    return { valid: false };
  }

  return { valid: true, displayName: member.displayName };
}

// ---------------------------------------------------------------------------
// consumeLoginToken
// ---------------------------------------------------------------------------

export interface ConsumeLoginTokenMeta {
  userAgent?: string | null;
}

export interface ConsumeLoginTokenResult {
  ok: boolean;
  sessionToken?: string;
  principal?: MemberPrincipal;
}

/**
 * Single-use guard first (`loginTokensRepo.consume` — one atomic UPDATE),
 * checked before anything else is written. Only on success does the rest
 * happen, and it happens in one `db.batch`: this is what makes it safe
 * against both double-submit (two POSTs racing the same token) and D1's
 * lack of interactive transactions (no read-modify-write spanning two
 * round trips).
 */
export async function consumeLoginToken(
  deps: AuthDeps,
  rawToken: string,
  meta: ConsumeLoginTokenMeta = {},
): Promise<ConsumeLoginTokenResult> {
  const now = deps.clock.now();
  const tokenHash = await hashToken(rawToken);

  const consumed = await loginTokensRepo.consume(deps.db, { tokenHash, now });
  if (!consumed) {
    return { ok: false };
  }

  const member = await membersRepo.getById(deps.db, consumed.memberId);
  if (!member || member.status === "disabled") {
    // Token existed and was unused/unexpired (now burned regardless), but
    // the member vanished or was disabled since the link was sent.
    return { ok: false };
  }

  const isFirstLogin = member.status === "invited";
  const rawSessionToken = generateToken();
  const sessionTokenHash = await hashToken(rawSessionToken);

  await authSessionsRepo.createFromLogin(deps.db, {
    memberId: member.id,
    tokenHash: sessionTokenHash,
    createdAt: now,
    expiresAt: now + sessionTtl(deps),
    userAgent: meta.userAgent ?? null,
    activateMemberAt: isFirstLogin ? now : undefined,
  });

  return {
    ok: true,
    sessionToken: rawSessionToken,
    principal: principalForMember(member.id, member.role),
  };
}

// ---------------------------------------------------------------------------
// resolveSession
// ---------------------------------------------------------------------------

/**
 * Resolve a session cookie to a principal. Rejects revoked/expired sessions
 * and sessions belonging to a since-disabled member. Sliding refresh: if
 * `lastSeenAt` is older than the refresh threshold (default 24h), extends
 * `lastSeenAt`/`expiresAt` — fired without being awaited, so a slow write
 * never adds latency to the response. (On Cloudflare Workers this will need
 * `ctx.waitUntil()` so the isolate doesn't get torn down mid-write; the
 * container profile targeted here just lets the event loop finish it.)
 */
export async function resolveSession(
  deps: AuthDeps,
  rawCookie: string,
): Promise<MemberPrincipal | undefined> {
  const tokenHash = await hashToken(rawCookie);
  const session = await authSessionsRepo.getByHash(deps.db, tokenHash);
  const now = deps.clock.now();

  if (!session || session.revokedAt !== null || session.expiresAt <= now) {
    return undefined;
  }

  const member = await membersRepo.getById(deps.db, session.memberId);
  if (!member || member.status === "disabled") {
    return undefined;
  }

  const refreshThreshold = deps.sessionRefreshThresholdMs ?? DEFAULT_SESSION_REFRESH_THRESHOLD_MS;
  if (now - session.lastSeenAt > refreshThreshold) {
    void authSessionsRepo
      .touch(deps.db, session.id, { lastSeenAt: now, expiresAt: now + sessionTtl(deps) })
      .catch(() => {
        // Best-effort: a failed refresh just means the session expires on
        // its original schedule, which is safe to ignore.
      });
  }

  return principalForMember(member.id, member.role);
}

export async function revokeSession(deps: AuthDeps, rawCookie: string): Promise<void> {
  const tokenHash = await hashToken(rawCookie);
  const session = await authSessionsRepo.getByHash(deps.db, tokenHash);
  if (!session) {
    return;
  }
  await authSessionsRepo.revoke(deps.db, session.id, deps.clock.now());
}

export async function revokeAllSessionsForMember(deps: AuthDeps, memberId: string): Promise<void> {
  await authSessionsRepo.revokeAllForMember(deps.db, memberId, deps.clock.now());
}

// ---------------------------------------------------------------------------
// service tokens
// ---------------------------------------------------------------------------

function parseServiceToken(raw: string): { tokenId: string; secret: string } | undefined {
  if (!raw.startsWith(SERVICE_TOKEN_PREFIX)) {
    return undefined;
  }
  const rest = raw.slice(SERVICE_TOKEN_PREFIX.length);
  // The token id is a fixed-length uuidv7 (hyphens only), so it can be
  // sliced off by length even though the secret itself may also contain
  // underscores (base64url's alphabet includes `_`) — splitting on the
  // separator character alone would be ambiguous.
  if (rest.length <= UUID_LENGTH + 1 || rest[UUID_LENGTH] !== "_") {
    return undefined;
  }
  const tokenId = rest.slice(0, UUID_LENGTH);
  const secret = rest.slice(UUID_LENGTH + 1);
  if (!secret) {
    return undefined;
  }
  return { tokenId, secret };
}

/**
 * Resolve a `Authorization: Bearer blk_{tokenId}_{secret}` header to a
 * service principal. Rejects unknown/revoked tokens and secret mismatches;
 * updates `lastUsedAt` on success.
 */
export async function resolveServiceToken(
  deps: AuthDeps,
  rawBearer: string,
): Promise<ServicePrincipal | undefined> {
  const parsed = parseServiceToken(rawBearer);
  if (!parsed) {
    return undefined;
  }

  const token = await serviceTokensRepo.getById(deps.db, parsed.tokenId);
  if (!token || token.revokedAt !== null) {
    return undefined;
  }

  const suppliedHash = await hashToken(parsed.secret);
  if (!timingSafeEqualHex(suppliedHash, token.tokenHash)) {
    return undefined;
  }

  await serviceTokensRepo.touchLastUsed(deps.db, token.id, deps.clock.now());

  return { kind: "service", tokenId: token.id, scopes: token.scopes as Scope[] };
}

export interface CreateServiceTokenInput {
  label: string;
  scopes: Scope[];
}

export interface CreateServiceTokenResult {
  id: string;
  label: string;
  scopes: Scope[];
  createdAt: number;
  /** The raw `blk_...` bearer token. Returned exactly once — never stored, never logged. */
  rawToken: string;
}

export async function createServiceToken(
  deps: AuthDeps,
  input: CreateServiceTokenInput,
): Promise<CreateServiceTokenResult> {
  const secret = generateToken();
  const secretHash = await hashToken(secret);
  const now = deps.clock.now();

  const row = await serviceTokensRepo.create(deps.db, {
    label: input.label,
    tokenHash: secretHash,
    scopes: input.scopes,
    createdAt: now,
  });

  return {
    id: row.id,
    label: row.label,
    scopes: row.scopes as Scope[],
    createdAt: row.createdAt,
    rawToken: `${SERVICE_TOKEN_PREFIX}${row.id}_${secret}`,
  };
}

// ---------------------------------------------------------------------------
// bootstrapAdmin
// ---------------------------------------------------------------------------

export interface BootstrapAdminInput {
  bootstrapToken: string;
  displayName: string;
  email: string;
}

export interface BootstrapAdminResult {
  ok: boolean;
  reason?: "already-bootstrapped" | "invalid-token";
  sessionToken?: string;
  principal?: MemberPrincipal;
  /** Whether the post-bootstrap test email succeeded. Never fails the bootstrap itself. */
  testEmailSent?: boolean;
}

/**
 * Create the very first member (admin/active) and hand back a session
 * directly — deliberately not by email, so a misconfigured mailer can't
 * lock the operator out of a fresh deploy. The insert is guarded against
 * concurrent bootstrap races by `membersRepo.createIfEmpty`'s `WHERE NOT
 * EXISTS`; the bootstrap token comparison hashes both sides first so
 * `timingSafeEqualHex`'s equal-length requirement holds regardless of the
 * raw token lengths, and so length itself doesn't leak via an early return.
 */
export async function bootstrapAdmin(
  deps: AuthDeps,
  input: BootstrapAdminInput,
): Promise<BootstrapAdminResult> {
  const configuredToken = deps.bootstrapToken ?? "";
  const [suppliedHash, expectedHash] = await Promise.all([
    hashToken(input.bootstrapToken),
    hashToken(configuredToken),
  ]);

  if (!configuredToken || !timingSafeEqualHex(suppliedHash, expectedHash)) {
    return { ok: false, reason: "invalid-token" };
  }

  const now = deps.clock.now();
  const member = await membersRepo.createIfEmpty(deps.db, {
    displayName: input.displayName,
    slug: slugify(input.displayName),
    email: input.email,
    createdAt: now,
    emailVerifiedAt: now,
  });

  if (!member) {
    return { ok: false, reason: "already-bootstrapped" };
  }

  const rawSessionToken = generateToken();
  const sessionTokenHash = await hashToken(rawSessionToken);
  await authSessionsRepo.create(deps.db, {
    memberId: member.id,
    tokenHash: sessionTokenHash,
    createdAt: now,
    expiresAt: now + sessionTtl(deps),
  });

  let testEmailSent = false;
  try {
    await deps.mailer.send({
      to: member.email,
      subject: "bandlib is set up",
      text: "This is a test message confirming outbound mail works for your bandlib deployment.",
    });
    testEmailSent = true;
  } catch {
    testEmailSent = false;
  }

  return {
    ok: true,
    sessionToken: rawSessionToken,
    principal: principalForMember(member.id, member.role),
    testEmailSent,
  };
}

import {
  type Db,
  authSessionsRepo,
  loginTokensRepo,
  membersRepo,
  serviceTokensRepo,
} from "@bandplate/db";
// Auth domain services — orchestrate the `members`/`login_tokens`/
// `auth_sessions`/`service_tokens` repos from `@bandplate/db` behind the
// behaviors the HTTP layer needs. No `node:*` imports; Web Crypto only.
import type { Locale } from "@bandplate/i18n";
import type { MemberPrincipal, MemberRole, Scope, ServicePrincipal } from "../auth/index.js";
import { scopesForRole } from "../auth/index.js";
import { generateToken, hashToken, timingSafeEqualHex } from "../crypto.js";
import { buildSetupTestMessage } from "../mail-messages.js";
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
/**
 * Bound on `bootstrapAdmin`'s confirmation-email send. Unlike
 * `requestLogin`, this send is not on a timing-sensitive path (there's no
 * account-enumeration signal to hide — the caller already knows whether
 * bootstrap succeeded), but it's still awaited inline before the response
 * is returned, so an unbounded hang against a dead/misconfigured mail
 * provider stalls the entire `/setup` response — the operator's very
 * first request — for however long the underlying `fetch`/SMTP transport
 * takes to time out (which can be much longer than this). Bound it
 * explicitly instead of trusting the transport's own timeout.
 */
export const DEFAULT_BOOTSTRAP_MAIL_TIMEOUT_MS = 5_000;

/**
 * Races `promise` against a timer, rejecting if it doesn't settle within
 * `timeoutMs`. Used only where an unbounded `await` on an external call
 * (mail, in `bootstrapAdmin`'s case) would otherwise stall a response
 * indefinitely — a plain `setTimeout`, not `deps.sleep`, since this isn't
 * on the timing-sensitive path `deps.sleep`/`loginTimingFloorMs` exist to
 * control, and real tests exercise it with a fast-resolving mock mailer
 * that never reaches the timeout.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const SERVICE_TOKEN_PREFIX = "bpk_";
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
  /** The operator-configured `BANDPLATE_BOOTSTRAP_TOKEN` value. Required by `bootstrapAdmin` only. */
  bootstrapToken?: string;
  /**
   * The app's own origin. Used by `bootstrapAdmin` only, and only for the
   * confirmation email — every other message derives its origin from the link
   * it carries, but this one has no link to derive it from.
   *
   * Optional so a caller that never bootstraps (the API's own `AuthDeps`, a
   * test) doesn't have to supply it; the message simply loses its button and
   * its mark, never its meaning.
   */
  appOrigin?: string;
  loginTokenTtlMs?: number;
  sessionTtlMs?: number;
  sessionRefreshThresholdMs?: number;
  /** See `DEFAULT_LOGIN_TIMING_FLOOR_MS`. */
  loginTimingFloorMs?: number;
  /** See the `Sleep` doc comment. Defaults to a real `setTimeout`-based wait. */
  sleep?: Sleep;
  /**
   * Called on EVERY `requestLogin`, with what actually happened — `"sent"`
   * when a token was minted and handed to the mailer, `"unknown"` when the
   * address belongs to no member (or to a disabled one) and nothing was sent.
   *
   * `/login` answers identically in both cases, and must: the members table
   * would otherwise be an account-enumeration oracle. The cost is that nobody
   * operating the app can tell the two apart — a developer typing the wrong
   * address locally, and an admin fielding "I never got the email", both see a
   * success banner and an empty log.
   *
   * This is a side channel to the OPERATOR's console, never to the client, so
   * it is wired in every configuration rather than only in dev. It receives
   * the address but never the token or the link: those appear only in the
   * console mailer's own output, which `loadConfig` refuses to enable under
   * NODE_ENV=production.
   */
  onLoginRequest?: (email: string, outcome: "sent" | "unknown") => void;
  /**
   * Escape hatch for taking the mail send out of the request path entirely
   * (the Workers profile — see `requestLogin`'s doc comment). When
   * provided, `requestLogin` hands it a thunk instead of awaiting
   * `mailer.sendLoginLink` inline; the caller is responsible for actually
   * running it (on Workers, via `ctx.waitUntil(thunk())`). Left unset on
   * the Node/container profile, which keeps awaiting the send inline and
   * relying on `loginTimingFloorMs` as before — this option changes
   * nothing there.
   */
  deferMailSend?: (send: () => Promise<void>) => void;
  /** See `DEFAULT_BOOTSTRAP_MAIL_TIMEOUT_MS`. */
  bootstrapMailTimeoutMs?: number;
}

function sessionTtl(deps: AuthDeps): number {
  return deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
}

function principalForMember(memberId: string, role: MemberRole, locale: Locale): MemberPrincipal {
  return { kind: "member", memberId, role, scopes: scopesForRole(role), locale };
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
 * Status and body alone aren't enough, though: a real mailer costs a round
 * trip for a whitelisted address but not for an unknown/disabled one, and
 * that gap is remotely measurable even with an identical response. On the
 * container profile (no `deps.deferMailSend`), this clamps total wall-clock
 * time to `loginTimingFloorMs` (default `DEFAULT_LOGIN_TIMING_FLOOR_MS`)
 * regardless of which branch ran, measured via the injected `Clock` (never
 * `Date.now()`, so tests can control it) and enforced via the injected
 * `sleep` primitive (never a bare `setTimeout` call inline, so tests can
 * fake the wait without actually blocking). That floor only hides the gap
 * when the mailer is faster than it — a slow relay still leaks the signal.
 *
 * On the Workers profile, pass `deps.deferMailSend` (wired to
 * `ctx.waitUntil`): the mail send is scheduled after the response is
 * already decided rather than awaited inline, so the mailer's latency
 * (fast or slow) never reaches the request/response timing at all. The
 * `loginTimingFloorMs` clamp still runs in that case too — harmless, and it
 * still covers the much smaller residual gap between "one indexed SELECT"
 * and "one SELECT plus one login_tokens INSERT".
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
      deps.onLoginRequest?.(email, "unknown");
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

    deps.onLoginRequest?.(member.email, "sent");

    const send = () =>
      deps.mailer.sendLoginLink(member.email, meta.buildLoginUrl(rawToken), {
        displayName: member.displayName,
        // Minutes, computed HERE because this is where the clock is. The
        // mailers used to receive the epoch and each render it as an ISO
        // timestamp, which is not a thing anyone reads.
        expiresInMinutes: Math.max(1, Math.round((expiresAt - now) / 60_000)),
      });
    if (deps.deferMailSend) {
      deps.deferMailSend(send);
    } else {
      await send();
    }
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
    principal: principalForMember(member.id, member.role, member.locale),
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

  return principalForMember(member.id, member.role, member.locale);
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
 * Resolve a `Authorization: Bearer bpk_{tokenId}_{secret}` header to a
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
  /** The raw `bpk_...` bearer token. Returned exactly once — never stored, never logged. */
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
  /**
   * The language for the very first member. `/setup` passes what the request's
   * `Accept-Language` asked for, so a Czech deployer is not handed English
   * merely because English is the fallback. Omitted means the default.
   */
  locale?: Locale;
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
 * lock the operator out of a fresh deploy. The bootstrap token comparison
 * hashes both sides first so `timingSafeEqualHex`'s equal-length
 * requirement holds regardless of the raw token lengths, and so length
 * itself doesn't leak via an early return.
 *
 * The member insert and the first session insert land in a single
 * `db.batch` — not two independent round trips. Each is its own guarded
 * `INSERT ... SELECT ... WHERE ...`: the member insert only fires if the
 * table is still empty (`membersRepo.buildCreateIfEmptyStatement`), and
 * the session insert only fires if a member with the generated id exists
 * (`authSessionsRepo.buildCreateIfMemberExistsStatement`) — which, since
 * the id is freshly generated for this call, is true exactly when *this
 * call's own* member insert just landed. That's what keeps a race against
 * a concurrent bootstrap safe without an interactive transaction: either
 * both writes land for the winner, or neither does — never a member with
 * no session (the lockout the direct-session design exists to avoid), and
 * never a session pointing at a member that was never created.
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
  const { id: memberId, statement: memberStatement } = membersRepo.buildCreateIfEmptyStatement(
    deps.db,
    {
      displayName: input.displayName,
      slug: slugify(input.displayName),
      email: input.email,
      createdAt: now,
      emailVerifiedAt: now,
      locale: input.locale,
    },
  );

  const rawSessionToken = generateToken();
  const sessionTokenHash = await hashToken(rawSessionToken);
  const { statement: sessionStatement } = authSessionsRepo.buildCreateIfMemberExistsStatement(
    deps.db,
    {
      memberId,
      tokenHash: sessionTokenHash,
      createdAt: now,
      expiresAt: now + sessionTtl(deps),
    },
  );

  await deps.db.batch([memberStatement, sessionStatement]);

  const member = await membersRepo.getById(deps.db, memberId);
  if (!member) {
    return { ok: false, reason: "already-bootstrapped" };
  }

  let testEmailSent = false;
  try {
    await withTimeout(
      // Shares the shell with the sign-in and invite messages: this is the
      // first thing a new deployer ever sees from their own install, and it
      // used to be one unstyled sentence of machine voice.
      deps.mailer.send(buildSetupTestMessage({ to: member.email, appOrigin: deps.appOrigin })),
      deps.bootstrapMailTimeoutMs ?? DEFAULT_BOOTSTRAP_MAIL_TIMEOUT_MS,
    );
    testEmailSent = true;
  } catch {
    testEmailSent = false;
  }

  return {
    ok: true,
    sessionToken: rawSessionToken,
    principal: principalForMember(member.id, member.role, member.locale),
    testEmailSent,
  };
}

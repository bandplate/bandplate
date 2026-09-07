// Scope vocabulary — the single enforcement mechanism for authorization.
// Roles (`member`/`admin`) are a UI/data concept that map deterministically
// onto scopes; nothing in this codebase should branch on `role` to decide
// whether a request is allowed (see `hasAllScopes` in `principal.ts`, the
// one authorization check).

export const SCOPES = [
  "songs:read",
  "songs:write",
  "takes:read",
  "takes:write",
  "events:read",
  "events:write",
  "votes:write",
  // Task 8: a member's own favorite/pin, on a song, take, OR event — NOT
  // folded into `votes:write`. Voting only ever applies to takes and is
  // inherently collective (it feeds a shared, public aggregate every other
  // member sees); favoriting applies to three different target types and
  // is purely personal bookmarking with no aggregate at all. Overloading
  // `votes:write` for it would mean a future "this member may vote but not
  // pin things" (or the reverse) policy has no scope to express, and would
  // make `votes:write`'s name a lie for the half of its behavior that isn't
  // voting. A distinct scope keeps both independently grantable/revocable,
  // the same reasoning `songs:write`/`events:write`/`takes:write` already
  // stay separate from each other despite every admin holding all three.
  "favorites:write",
  "ingest:write",
  "members:admin",
  "tokens:admin",
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/**
 * Member role — the UI-facing concept. Deliberately structurally
 * compatible with (but not imported from) `@bandplate/db`'s
 * `members.role` column type, so this package doesn't need to depend on
 * the schema just to name the two roles.
 */
export type MemberRole = "member" | "admin";

const MEMBER_SCOPES: readonly Scope[] = [
  "songs:read",
  "takes:read",
  "events:read",
  "votes:write",
  "favorites:write",
];

/** Derive a member's scopes from their role. This is the only place role -> scopes happens. */
export function scopesForRole(role: MemberRole): Scope[] {
  if (role === "admin") {
    return [...SCOPES];
  }
  return [...MEMBER_SCOPES];
}

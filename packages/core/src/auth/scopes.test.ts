import { describe, expect, it } from "vitest";
import { hasAllScopes } from "./principal.js";
import { SCOPES, scopesForRole } from "./scopes.js";

describe("scopesForRole", () => {
  it("gives members every :read scope, the three content :write scopes, votes and favorites", () => {
    const scopes = scopesForRole("member");
    expect(scopes.sort()).toEqual(
      [
        "songs:read",
        "songs:write",
        "takes:read",
        "takes:write",
        "events:read",
        "events:write",
        "votes:write",
        "favorites:write",
      ].sort(),
    );
  });

  it("gives admins every scope in the vocabulary", () => {
    const scopes = scopesForRole("admin");
    expect(scopes.sort()).toEqual([...SCOPES].sort());
  });

  /*
   * This replaces an earlier assertion that a member held no `:write` scope
   * beyond votes and favorites. That was the right invariant while the ingest
   * API was the only way content got in; M8 deliberately reversed it, because
   * a member who can add a song is the whole point of a shared band archive.
   *
   * The invariant that SURVIVES is the one below: three scopes are admin-only,
   * and no widening of the member role may quietly pick one up. Destruction is
   * not on this list because it is not a scope at all — it is `members:admin`
   * plus the `/admin/*` path guard.
   */
  it("never gives a member an admin-only scope", () => {
    const adminOnly = ["ingest:write", "members:admin", "tokens:admin"];
    const scopes = scopesForRole("member");
    expect(scopes.filter((s) => adminOnly.includes(s))).toEqual([]);
  });
});

describe("hasAllScopes", () => {
  it("returns false for an undefined principal", () => {
    expect(hasAllScopes(undefined, ["songs:read"])).toBe(false);
  });

  it("returns true when the principal holds every required scope", () => {
    const principal = {
      kind: "member" as const,
      memberId: "m1",
      role: "member" as const,
      scopes: scopesForRole("member"),
      // Presentation, not authorization — `hasAllScopes` never reads it.
      locale: "en" as const,
    };
    expect(hasAllScopes(principal, ["songs:read", "votes:write"])).toBe(true);
  });

  it("returns false when the principal is missing one required scope", () => {
    const principal = {
      kind: "member" as const,
      memberId: "m1",
      role: "member" as const,
      scopes: scopesForRole("member"),
      // Presentation, not authorization — `hasAllScopes` never reads it.
      locale: "en" as const,
    };
    expect(hasAllScopes(principal, ["songs:read", "members:admin"])).toBe(false);
  });

  it("returns true for an empty requirement list regardless of principal scopes", () => {
    const principal = { kind: "service" as const, tokenId: "t1", scopes: [] };
    expect(hasAllScopes(principal, [])).toBe(true);
  });
});

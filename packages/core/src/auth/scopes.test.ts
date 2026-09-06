import { describe, expect, it } from "vitest";
import { hasAllScopes } from "./principal.js";
import { SCOPES, scopesForRole } from "./scopes.js";

describe("scopesForRole", () => {
  it("gives members every :read scope plus votes:write, nothing else", () => {
    const scopes = scopesForRole("member");
    expect(scopes.sort()).toEqual(
      ["songs:read", "takes:read", "events:read", "votes:write"].sort(),
    );
  });

  it("gives admins every scope in the vocabulary", () => {
    const scopes = scopesForRole("admin");
    expect(scopes.sort()).toEqual([...SCOPES].sort());
  });

  it("never gives a member a :write scope other than votes:write", () => {
    const scopes = scopesForRole("member");
    const writeScopes = scopes.filter((s) => s.endsWith(":write"));
    expect(writeScopes).toEqual(["votes:write"]);
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
    };
    expect(hasAllScopes(principal, ["songs:read", "votes:write"])).toBe(true);
  });

  it("returns false when the principal is missing one required scope", () => {
    const principal = {
      kind: "member" as const,
      memberId: "m1",
      role: "member" as const,
      scopes: scopesForRole("member"),
    };
    expect(hasAllScopes(principal, ["songs:read", "members:admin"])).toBe(false);
  });

  it("returns true for an empty requirement list regardless of principal scopes", () => {
    const principal = { kind: "service" as const, tokenId: "t1", scopes: [] };
    expect(hasAllScopes(principal, [])).toBe(true);
  });
});

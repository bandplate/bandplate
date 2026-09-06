import type { MemberPrincipal, Principal, Scope } from "@bandlib/core";
import { describe, expect, it } from "vitest";
import { guardAdminPath } from "./guard.js";

function member(scopes: Scope[]): MemberPrincipal {
  return { kind: "member", memberId: "m1", role: "member", scopes };
}

describe("guardAdminPath", () => {
  it("allows any principal (including anonymous) on a non-admin path", () => {
    expect(guardAdminPath("/login", undefined)).toEqual({ kind: "allow" });
    expect(guardAdminPath("/", member([]))).toEqual({ kind: "allow" });
  });

  it("redirects an anonymous visitor to /login for /admin and nested paths", () => {
    expect(guardAdminPath("/admin", undefined)).toEqual({ kind: "redirect", to: "/login" });
    expect(guardAdminPath("/admin/members", undefined)).toEqual({ kind: "redirect", to: "/login" });
  });

  it("forbids a member principal that lacks the members:admin scope", () => {
    const decision = guardAdminPath("/admin/members", member(["songs:read", "takes:read"]));
    expect(decision).toEqual({ kind: "forbidden" });
  });

  it("admits a member principal that carries the members:admin scope", () => {
    const decision = guardAdminPath("/admin/members", member(["members:admin", "tokens:admin"]));
    expect(decision).toEqual({ kind: "allow" });
  });

  it("forbids a service principal even if it happens to carry members:admin", () => {
    const service: Principal = { kind: "service", tokenId: "t1", scopes: ["members:admin"] };
    expect(guardAdminPath("/admin", service)).toEqual({ kind: "forbidden" });
  });

  // Pins the specific scope the guard checks. The previous fixtures always
  // gave the "allowed" principal BOTH members:admin and tokens:admin, so a
  // guard that checked `tokens:admin` internally would have passed every
  // existing test too. These two cases each carry exactly one of the two.
  it("admits a member principal that carries ONLY members:admin (not tokens:admin)", () => {
    const decision = guardAdminPath("/admin/members", member(["members:admin"]));
    expect(decision).toEqual({ kind: "allow" });
  });

  it("forbids a member principal that carries ONLY tokens:admin (not members:admin)", () => {
    const decision = guardAdminPath("/admin/members", member(["tokens:admin"]));
    expect(decision).toEqual({ kind: "forbidden" });
  });
});

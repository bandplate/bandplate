import type { MemberPrincipal, Principal, Scope } from "@bandlib/core";
import { describe, expect, it } from "vitest";
import { guardAdminPath, guardMemberPath, isPublicPath } from "./guard.js";

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

describe("isPublicPath", () => {
  it("matches the public allowlist and nested paths under it", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/some-token")).toBe(true);
    expect(isPublicPath("/setup")).toBe(true);
    expect(isPublicPath("/logout")).toBe(true);
    expect(isPublicPath("/api")).toBe(true);
    expect(isPublicPath("/api/songs")).toBe(true);
    expect(isPublicPath("/_astro/chunk-abc123.js")).toBe(true);
  });

  it("does not match member/admin paths, or a prefix collision like /loginish", () => {
    expect(isPublicPath("/songs")).toBe(false);
    expect(isPublicPath("/events/abc-123")).toBe(false);
    expect(isPublicPath("/admin")).toBe(false);
    expect(isPublicPath("/loginish")).toBe(false);
  });

  // The whole point of deny-by-default: a route nobody has registered
  // anywhere must still come back non-public, so `guardMemberPath` gates it.
  // This is the failure mode the old member-path ALLOWLIST could not catch —
  // a brand-new route shipped unguarded simply by never being added to it.
  it("treats a brand-new, never-registered route as non-public — Task 6's /takes/[id]", () => {
    expect(isPublicPath("/takes/some-take-id")).toBe(false);
    expect(isPublicPath("/some-route-nobody-has-written-yet")).toBe(false);
  });
});

describe("guardMemberPath", () => {
  it("allows any principal (including anonymous) on a public path", () => {
    expect(guardMemberPath("/login", undefined)).toEqual({ kind: "allow" });
    expect(guardMemberPath("/", undefined)).toEqual({ kind: "allow" });
    expect(guardMemberPath("/api/songs", undefined)).toEqual({ kind: "allow" });
  });

  it("redirects an anonymous visitor to /login for /songs and /events", () => {
    expect(guardMemberPath("/songs", undefined)).toEqual({ kind: "redirect", to: "/login" });
    expect(guardMemberPath("/events/abc-123", undefined)).toEqual({
      kind: "redirect",
      to: "/login",
    });
  });

  // The regression this whole finding is about: a route that exists in the
  // app (linked from TakeRow.astro) but was never added to any guard list.
  // Deny-by-default must still redirect an anonymous visitor away from it —
  // proving the guard, not a remembered registration, is what protects it.
  it("redirects an anonymous visitor away from a brand-new, unregistered route", () => {
    expect(guardMemberPath("/takes/some-take-id", undefined)).toEqual({
      kind: "redirect",
      to: "/login",
    });
  });

  it("admits any signed-in member on both a known member path and an unregistered one", () => {
    expect(guardMemberPath("/songs", member(["songs:read"]))).toEqual({ kind: "allow" });
    expect(guardMemberPath("/events", member([]))).toEqual({ kind: "allow" });
    expect(guardMemberPath("/takes/some-take-id", member([]))).toEqual({ kind: "allow" });
  });
});

// "Middleware: anonymous, member, and admin principals resolve correctly"
// — exercised against the real `resolveSession` core service and a real
// (in-memory) db, not a mock, so this proves the actual cookie -> principal
// path apps/web wires up, not just that a fake returns what we told it to.
import { type AuthDeps, generateToken, hashToken, systemClock } from "@bandplate/core";
import { authSessionsRepo, membersRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { createNullMailer } from "@bandplate/mail";
import { beforeEach, describe, expect, it } from "vitest";
import { resolvePrincipalFromCookie } from "./principal.js";

describe("resolvePrincipalFromCookie", () => {
  let auth: AuthDeps;

  beforeEach(async () => {
    const db = await createTestDb();
    auth = { db, mailer: createNullMailer(), clock: systemClock };
  });

  it("resolves to undefined for an anonymous request (no cookie)", async () => {
    const principal = await resolvePrincipalFromCookie(auth, undefined);
    expect(principal).toBeUndefined();
  });

  it("resolves to undefined for a cookie that matches no session", async () => {
    const principal = await resolvePrincipalFromCookie(auth, "not-a-real-token");
    expect(principal).toBeUndefined();
  });

  it("resolves a member principal for a valid session belonging to a member-role member", async () => {
    const member = await membersRepo.create(auth.db, {
      displayName: "Bailey",
      slug: "bailey",
      email: "bailey@example.com",
      role: "member",
      status: "active",
      createdAt: 1_000,
    });
    const raw = generateToken();
    await authSessionsRepo.create(auth.db, {
      memberId: member.id,
      tokenHash: await hashToken(raw),
      createdAt: 1_000,
      expiresAt: Date.now() + 1_000_000,
    });

    const principal = await resolvePrincipalFromCookie(auth, raw);

    expect(principal?.kind).toBe("member");
    expect(principal?.role).toBe("member");
    expect(principal?.scopes).not.toContain("members:admin");
  });

  it("resolves an admin principal (carrying members:admin) for a valid session belonging to an admin-role member", async () => {
    const admin = await membersRepo.create(auth.db, {
      displayName: "Alex",
      slug: "alex",
      email: "alex@example.com",
      role: "admin",
      status: "active",
      createdAt: 1_000,
    });
    const raw = generateToken();
    await authSessionsRepo.create(auth.db, {
      memberId: admin.id,
      tokenHash: await hashToken(raw),
      createdAt: 1_000,
      expiresAt: Date.now() + 1_000_000,
    });

    const principal = await resolvePrincipalFromCookie(auth, raw);

    expect(principal?.kind).toBe("member");
    expect(principal?.role).toBe("admin");
    expect(principal?.scopes).toContain("members:admin");
  });
});

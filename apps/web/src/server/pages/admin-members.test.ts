import { type AuthDeps, systemClock } from "@bandlib/core";
import { createTestDb } from "@bandlib/db/testing";
import { createNullMailer } from "@bandlib/mail";
import { beforeEach, describe, expect, it } from "vitest";
import { createMember, listMembers, revokeMemberSessions, updateMember } from "./admin-members.js";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

describe("admin members page logic", () => {
  let auth: AuthDeps;

  beforeEach(async () => {
    const db = await createTestDb();
    auth = { db, mailer: createNullMailer(), clock: systemClock };
  });

  it("creates a member from a plain form submission", async () => {
    const result = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "bailey@example.com" }),
    );
    expect(result.kind).toBe("ok");

    const members = await listMembers(auth.db);
    expect(members).toHaveLength(1);
    expect(members[0]?.email).toBe("bailey@example.com");
    expect(members[0]?.role).toBe("member");
  });

  it("rejects a duplicate email without creating a second row", async () => {
    await createMember(auth.db, 1_000, formData({ displayName: "Bailey", email: "b@example.com" }));
    const second = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey 2", email: "b@example.com" }),
    );
    expect(second.kind).toBe("email_taken");
    expect(await listMembers(auth.db)).toHaveLength(1);
  });

  it("rejects an invalid email address, tagging the email field", async () => {
    const result = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "not-an-email" }),
    );
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.field).toBe("email");
    }
    expect(await listMembers(auth.db)).toHaveLength(0);
  });

  it("rejects a missing display name, tagging the displayName field", async () => {
    const result = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "", email: "bailey@example.com" }),
    );
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.field).toBe("displayName");
    }
  });

  it("updates role and status together in one call", async () => {
    await createMember(auth.db, 1_000, formData({ displayName: "Bailey", email: "b@example.com" }));
    const [member] = await listMembers(auth.db);
    if (!member) throw new Error("expected a member");

    const result = await updateMember(
      auth.db,
      member.id,
      formData({ role: "admin", status: "active" }),
      "some-other-acting-admin-id",
    );
    expect(result.kind).toBe("ok");

    const [updated] = await listMembers(auth.db);
    expect(updated?.role).toBe("admin");
    expect(updated?.status).toBe("active");
  });

  it("reports not_found for an unknown member id", async () => {
    const result = await updateMember(
      auth.db,
      "00000000-0000-0000-0000-000000000000",
      formData({ role: "admin" }),
      "some-other-acting-admin-id",
    );
    expect(result.kind).toBe("not_found");
  });

  it("rejects a patch with neither status nor role set (the dropped .refine)", async () => {
    await createMember(auth.db, 1_000, formData({ displayName: "Bailey", email: "b@example.com" }));
    const [member] = await listMembers(auth.db);
    if (!member) throw new Error("expected a member");

    const result = await updateMember(
      auth.db,
      member.id,
      formData({}),
      "some-other-acting-admin-id",
    );
    expect(result.kind).toBe("invalid");
  });

  it("rejects a self-targeted update outright, even one that only touches status", async () => {
    await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Alex", email: "alex@example.com" }),
    );
    const [admin] = await listMembers(auth.db);
    if (!admin) throw new Error("expected a member");

    const result = await updateMember(
      auth.db,
      admin.id,
      formData({ status: "active" }),
      admin.id, // acting as themselves
    );
    expect(result.kind).toBe("self");

    const [unchanged] = await listMembers(auth.db);
    expect(unchanged?.status).toBe(admin.status);
  });

  it("refuses to demote the last active admin", async () => {
    await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Alex", email: "alex@example.com" }),
    );
    const [alex] = await listMembers(auth.db);
    if (!alex) throw new Error("expected a member");
    await updateMember(
      auth.db,
      alex.id,
      formData({ role: "admin", status: "active" }),
      "bootstrap",
    );

    await createMember(auth.db, 1_000, formData({ displayName: "Bailey", email: "b@example.com" }));
    const members = await listMembers(auth.db);
    const bailey = members.find((m) => m.email === "b@example.com");
    if (!bailey) throw new Error("expected bailey");

    // Bailey (not an admin) tries to demote Alex, the only admin.
    const result = await updateMember(auth.db, alex.id, formData({ role: "member" }), bailey.id);
    expect(result.kind).toBe("last_admin");

    const [stillAlex] = await listMembers(auth.db);
    expect(stillAlex?.role).toBe("admin");
  });

  it("allows demoting an admin when another active admin remains", async () => {
    await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Alex", email: "alex@example.com" }),
    );
    await createMember(auth.db, 1_000, formData({ displayName: "Bailey", email: "b@example.com" }));
    const members = await listMembers(auth.db);
    const alex = members.find((m) => m.email === "alex@example.com");
    const bailey = members.find((m) => m.email === "b@example.com");
    if (!alex || !bailey) throw new Error("expected both members");

    await updateMember(
      auth.db,
      alex.id,
      formData({ role: "admin", status: "active" }),
      "bootstrap",
    );
    await updateMember(
      auth.db,
      bailey.id,
      formData({ role: "admin", status: "active" }),
      "bootstrap",
    );

    // Bailey demotes Alex; Bailey is still an active admin, so this is fine.
    const result = await updateMember(auth.db, alex.id, formData({ role: "member" }), bailey.id);
    expect(result.kind).toBe("ok");
  });

  it("revokeMemberSessions reports not_found for an unknown member id", async () => {
    const result = await revokeMemberSessions(
      auth.db,
      auth,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(result.kind).toBe("not_found");
  });
});

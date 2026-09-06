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

  it("updates role and status together in one call", async () => {
    await createMember(auth.db, 1_000, formData({ displayName: "Bailey", email: "b@example.com" }));
    const [member] = await listMembers(auth.db);
    if (!member) throw new Error("expected a member");

    const result = await updateMember(
      auth.db,
      member.id,
      formData({ role: "admin", status: "active" }),
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
    );
    expect(result.kind).toBe("not_found");
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

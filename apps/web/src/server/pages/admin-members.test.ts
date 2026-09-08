import { type AuthDeps, systemClock } from "@bandplate/core";
import { instrumentsRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { type CapturingMailer, createCapturingMailer } from "@bandplate/mail";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMember,
  listAllInstruments,
  listMembers,
  listMembersWithLastSeen,
  resendMemberInvite,
  revokeMemberSessions,
  updateMember,
  updateMemberInstruments,
} from "./admin-members.js";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

describe("admin members page logic", () => {
  let auth: AuthDeps;
  let mailer: CapturingMailer;
  let invite: { mailer: CapturingMailer; appOrigin: string };

  beforeEach(async () => {
    const db = await createTestDb();
    mailer = createCapturingMailer();
    auth = { db, mailer, clock: systemClock };
    invite = { mailer, appOrigin: "https://bandplate.example" };
  });

  it("creates a member from a plain form submission", async () => {
    const result = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "bailey@example.com" }),
      invite,
    );
    expect(result.kind).toBe("ok");

    const members = await listMembers(auth.db);
    expect(members).toHaveLength(1);
    expect(members[0]?.email).toBe("bailey@example.com");
    expect(members[0]?.role).toBe("member");
  });

  // Being added and being TOLD you were added are not the same thing — until
  // this shipped, only the first happened and a new member sat in the roster
  // with no idea the archive existed.
  it("emails the new member an invitation naming the sign-in page", async () => {
    const result = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "bailey@example.com" }),
      invite,
    );
    expect(result).toMatchObject({ kind: "ok", invited: true });

    const sent = mailer.sent.filter((m) => m.kind === "message");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "bailey@example.com" });
    const body = sent[0]?.kind === "message" ? sent[0].text : "";
    expect(body).toContain("https://bandplate.example/login");
    // No token, deliberately: an invitation is a notification, not a
    // credential. See `sendMemberInvite`.
    expect(body).not.toMatch(/\/login\/[A-Za-z0-9_-]{10,}/);
  });

  it("still creates the member when the invitation cannot be sent, and says so", async () => {
    const broken = {
      mailer: {
        async sendLoginLink() {},
        async send() {
          throw new Error("provider down");
        },
      },
      appOrigin: "https://bandplate.example",
    };
    const result = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "bailey@example.com" }),
      broken,
    );
    expect(result).toMatchObject({ kind: "ok", invited: false });
    expect(await listMembers(auth.db)).toHaveLength(1);
  });

  it("resends the invitation on demand, and reports an unknown member", async () => {
    const created = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "bailey@example.com" }),
      invite,
    );
    const id = created.kind === "ok" ? created.member.id : "";
    mailer.clear();

    expect(await resendMemberInvite(auth.db, id, invite)).toEqual({ kind: "ok", invited: true });
    expect(mailer.sent).toHaveLength(1);

    expect(
      await resendMemberInvite(auth.db, "00000000-0000-0000-0000-000000000000", invite),
    ).toEqual({ kind: "not_found" });
  });

  it("rejects a duplicate email without creating a second row", async () => {
    await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "b@example.com" }),
      invite,
    );
    const second = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey 2", email: "b@example.com" }),
      invite,
    );
    expect(second.kind).toBe("email_taken");
    expect(await listMembers(auth.db)).toHaveLength(1);
  });

  it("rejects an invalid email address, tagging the email field", async () => {
    const result = await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "not-an-email" }),
      invite,
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
      invite,
    );
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.field).toBe("displayName");
    }
  });

  it("updates role and status together in one call", async () => {
    await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "b@example.com" }),
      invite,
    );
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
    await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "b@example.com" }),
      invite,
    );
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
      invite,
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
      invite,
    );
    const [alex] = await listMembers(auth.db);
    if (!alex) throw new Error("expected a member");
    await updateMember(
      auth.db,
      alex.id,
      formData({ role: "admin", status: "active" }),
      "bootstrap",
    );

    await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "b@example.com" }),
      invite,
    );
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
      invite,
    );
    await createMember(
      auth.db,
      1_000,
      formData({ displayName: "Bailey", email: "b@example.com" }),
      invite,
    );
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

  describe("member instruments (Task 6 review round 1's data-model gap)", () => {
    it("updateMemberInstruments sets the roster's instrumentIds for that member only", async () => {
      await createMember(
        auth.db,
        1_000,
        formData({ displayName: "Bailey", email: "b@example.com" }),
        invite,
      );
      await createMember(
        auth.db,
        1_000,
        formData({ displayName: "Cass", email: "c@example.com" }),
        invite,
      );
      const [bailey, cass] = await listMembers(auth.db);
      if (!bailey || !cass) throw new Error("expected both members");
      const drums = await instrumentsRepo.create(auth.db, { slug: "drums", label: "Drums" });

      const fd = new FormData();
      fd.set("memberId", bailey.id);
      fd.append("instrumentIds", drums.id);
      await updateMemberInstruments(auth.db, bailey.id, fd);

      const roster = await listMembersWithLastSeen(auth.db);
      expect(roster.find((m) => m.id === bailey.id)?.instrumentIds).toEqual([drums.id]);
      expect(roster.find((m) => m.id === cass.id)?.instrumentIds).toEqual([]);
    });

    it("updateMemberInstruments with no instrumentIds fields clears the set", async () => {
      await createMember(
        auth.db,
        1_000,
        formData({ displayName: "Bailey", email: "b@example.com" }),
        invite,
      );
      const [bailey] = await listMembers(auth.db);
      if (!bailey) throw new Error("expected a member");
      const drums = await instrumentsRepo.create(auth.db, { slug: "drums", label: "Drums" });
      await updateMemberInstruments(
        auth.db,
        bailey.id,
        (() => {
          const fd = new FormData();
          fd.set("memberId", bailey.id);
          fd.append("instrumentIds", drums.id);
          return fd;
        })(),
      );

      await updateMemberInstruments(auth.db, bailey.id, formData({ memberId: bailey.id }));

      const roster = await listMembersWithLastSeen(auth.db);
      expect(roster.find((m) => m.id === bailey.id)?.instrumentIds).toEqual([]);
    });

    it("listAllInstruments includes archived instruments (so the multi-select doesn't drop them)", async () => {
      const drums = await instrumentsRepo.create(auth.db, { slug: "drums", label: "Drums" });
      await instrumentsRepo.archive(auth.db, drums.id, 2_000);

      const all = await listAllInstruments(auth.db);
      expect(all.map((i) => i.id)).toContain(drums.id);
      expect(all.find((i) => i.id === drums.id)?.archivedAt).not.toBeNull();
    });

    // Fix round 2, item 3: `updateMemberInstruments` used to validate
    // nothing, so a tampered `memberId`/`instrumentIds` fell through to
    // `setInstruments`' FK constraint as an unhandled 500 instead of the
    // typed result the page renders as a Banner (same pattern
    // `updateMember` already follows).
    it("reports not_found for an unknown memberId, rather than letting the FK violation surface as a 500", async () => {
      const drums = await instrumentsRepo.create(auth.db, { slug: "drums", label: "Drums" });
      const fd = new FormData();
      fd.set("memberId", "00000000-0000-0000-0000-000000000000");
      fd.append("instrumentIds", drums.id);

      const result = await updateMemberInstruments(
        auth.db,
        "00000000-0000-0000-0000-000000000000",
        fd,
      );
      expect(result.kind).toBe("not_found");
    });

    it("reports invalid for a bogus instrumentIds value, and leaves the member's existing instruments unchanged", async () => {
      await createMember(
        auth.db,
        1_000,
        formData({ displayName: "Bailey", email: "b@example.com" }),
        invite,
      );
      const [bailey] = await listMembers(auth.db);
      if (!bailey) throw new Error("expected a member");
      const drums = await instrumentsRepo.create(auth.db, { slug: "drums", label: "Drums" });
      await updateMemberInstruments(
        auth.db,
        bailey.id,
        (() => {
          const fd = new FormData();
          fd.set("memberId", bailey.id);
          fd.append("instrumentIds", drums.id);
          return fd;
        })(),
      );

      const fd = new FormData();
      fd.set("memberId", bailey.id);
      fd.append("instrumentIds", "not-a-real-instrument-id");
      const result = await updateMemberInstruments(auth.db, bailey.id, fd);
      expect(result.kind).toBe("invalid");

      const roster = await listMembersWithLastSeen(auth.db);
      expect(roster.find((m) => m.id === bailey.id)?.instrumentIds).toEqual([drums.id]);
    });
  });
});

// `/admin/members` page logic. Mirrors `packages/api/src/routes/admin-members.ts`
// exactly (same validation, same repo calls) — this is the Astro
// composition root's own front door onto the same domain layer, not a
// second, divergent implementation of member management.
import type { AuthDeps } from "@bandlib/core";
import { revokeAllSessionsForMember, slugify } from "@bandlib/core";
import type { Db } from "@bandlib/db";
import { authSessionsRepo, membersRepo } from "@bandlib/db";
import { z } from "zod";

type Member = membersRepo.Member;

export async function listMembers(db: Db): Promise<Member[]> {
  return membersRepo.list(db);
}

export interface MemberWithLastSeen extends Member {
  lastSeenAt: number | undefined;
}

export async function listMembersWithLastSeen(db: Db): Promise<MemberWithLastSeen[]> {
  const [members, lastSeenByMember] = await Promise.all([
    membersRepo.list(db),
    authSessionsRepo.getLastSeenAtByMember(db),
  ]);
  return members.map((member) => ({ ...member, lastSeenAt: lastSeenByMember.get(member.id) }));
}

const createMemberSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name.").max(200),
  // `.email()`, not just non-empty — a display name typo in the email
  // field used to create a member who could never log in (the login flow
  // only ever accepts a real address to send a link to), with nothing at
  // creation time to catch it.
  email: z
    .string()
    .trim()
    .min(1, "Enter an email address.")
    .max(320)
    .email("Enter a valid email address."),
  role: z.enum(["member", "admin"]).optional(),
});

export type CreateMemberField = "displayName" | "email";

export type CreateMemberResult =
  | { kind: "ok"; member: Member }
  | { kind: "invalid"; error: string; field: CreateMemberField }
  | { kind: "email_taken" };

export async function createMember(
  db: Db,
  now: number,
  formData: FormData,
): Promise<CreateMemberResult> {
  const parsed = createMemberSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    role: formData.get("role") || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = (issue?.path[0] as CreateMemberField | undefined) ?? "displayName";
    return { kind: "invalid", error: issue?.message ?? "Invalid input.", field };
  }

  const existing = await membersRepo.getByEmail(db, parsed.data.email);
  if (existing) {
    return { kind: "email_taken" };
  }

  const member = await membersRepo.create(db, {
    displayName: parsed.data.displayName,
    slug: slugify(parsed.data.displayName),
    email: parsed.data.email,
    role: parsed.data.role,
    createdAt: now,
  });
  return { kind: "ok", member };
}

const patchMemberSchema = z
  .object({
    status: z.enum(["invited", "active", "disabled"]).optional(),
    role: z.enum(["member", "admin"]).optional(),
  })
  // Restored to match `packages/api/src/routes/admin-members.ts`'s
  // `patchMemberSchema` exactly — the web copy dropped this `.refine` in
  // the first pass, so `intent=update` with neither field set parsed
  // successfully and did nothing, but still redirected to `?updated=1` as
  // if it had.
  .refine((v) => v.status !== undefined || v.role !== undefined, {
    message: "At least one of status or role is required.",
  });

export type UpdateMemberResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "invalid" }
  | { kind: "self" }
  | { kind: "last_admin" };

export async function updateMember(
  db: Db,
  id: string,
  formData: FormData,
  actingMemberId: string,
): Promise<UpdateMemberResult> {
  // An admin can otherwise demote or disable their own only working
  // account and lock themselves out unrecoverably — `/setup` 404s once any
  // member exists, so there is no self-service way back in. The UI hides
  // these controls on the acting principal's own row (see
  // `members/index.astro`); this is the server-side backstop for a
  // crafted request that submits one anyway.
  if (id === actingMemberId) {
    return { kind: "self" };
  }

  const parsed = patchMemberSchema.safeParse({
    status: formData.get("status") || undefined,
    role: formData.get("role") || undefined,
  });
  if (!parsed.success) {
    return { kind: "invalid" };
  }

  const existing = await membersRepo.getById(db, id);
  if (!existing) {
    return { kind: "not_found" };
  }

  const nextRole = parsed.data.role ?? existing.role;
  const nextStatus = parsed.data.status ?? existing.status;
  const demotesOrDisablesAnAdmin =
    existing.role === "admin" && (nextRole !== "admin" || nextStatus === "disabled");

  if (demotesOrDisablesAnAdmin) {
    // Cheap at this scale (a band roster, not a userbase) — list every
    // member rather than maintaining a running admin count.
    const allMembers = await membersRepo.list(db);
    const otherActiveAdmins = allMembers.filter(
      (m) => m.id !== id && m.role === "admin" && m.status !== "disabled",
    );
    if (otherActiveAdmins.length === 0) {
      return { kind: "last_admin" };
    }
  }

  const update: membersRepo.UpdateMemberInput = {};
  if (parsed.data.status !== undefined) {
    update.status = parsed.data.status;
  }
  if (parsed.data.role !== undefined) {
    update.role = parsed.data.role;
  }
  await membersRepo.update(db, id, update);
  return { kind: "ok" };
}

export async function getMember(db: Db, id: string): Promise<Member | undefined> {
  return membersRepo.getById(db, id);
}

export type RevokeSessionsResult = { kind: "ok" } | { kind: "not_found" };

export async function revokeMemberSessions(
  db: Db,
  auth: AuthDeps,
  id: string,
): Promise<RevokeSessionsResult> {
  const existing = await membersRepo.getById(db, id);
  if (!existing) {
    return { kind: "not_found" };
  }
  await revokeAllSessionsForMember(auth, id);
  return { kind: "ok" };
}

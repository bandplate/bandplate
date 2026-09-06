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
  email: z.string().trim().min(1, "Enter an email address.").max(320),
  role: z.enum(["member", "admin"]).optional(),
});

export type CreateMemberResult =
  | { kind: "ok"; member: Member }
  | { kind: "invalid"; error: string }
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
    return { kind: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid input." };
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

const patchMemberSchema = z.object({
  status: z.enum(["invited", "active", "disabled"]).optional(),
  role: z.enum(["member", "admin"]).optional(),
});

export type UpdateMemberResult = { kind: "ok" } | { kind: "not_found" } | { kind: "invalid" };

export async function updateMember(
  db: Db,
  id: string,
  formData: FormData,
): Promise<UpdateMemberResult> {
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

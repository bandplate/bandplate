// `/admin/members` page logic. Calls the exact same `@bandlib/core`
// functions `packages/api/src/routes/admin-members.ts` calls for
// validation (`createMemberSchema`/`patchMemberSchema`) and for the
// self-demotion/last-admin guard (`updateMemberWithGuards`) — this is the
// Astro composition root's own front door onto the same domain layer, not
// a second, divergent implementation of member management. See
// task-4-report.md "Fix round 2": the API route used to have no
// self-demotion/last-admin guard of its own at all, which this shared
// function structurally rules out going forward.
import type { AuthDeps } from "@bandlib/core";
import {
  createMemberSchema,
  patchMemberSchema,
  revokeAllSessionsForMember,
  slugify,
  updateMemberWithGuards,
} from "@bandlib/core";
import type { Db } from "@bandlib/db";
import { authSessionsRepo, instrumentsRepo, membersRepo } from "@bandlib/db";

type Member = membersRepo.Member;

export async function listMembers(db: Db): Promise<Member[]> {
  return membersRepo.list(db);
}

export interface MemberWithLastSeen extends Member {
  lastSeenAt: number | undefined;
  /** Ids only — the roster page joins these against `listAllInstruments`' rows
   *  itself, so an archived instrument's label/archived state is read from one
   *  place rather than duplicated onto every member row. */
  instrumentIds: string[];
}

export async function listMembersWithLastSeen(db: Db): Promise<MemberWithLastSeen[]> {
  const [members, lastSeenByMember] = await Promise.all([
    membersRepo.list(db),
    authSessionsRepo.getLastSeenAtByMember(db),
  ]);
  const instrumentsByMember = await membersRepo.listInstrumentsForMembers(
    db,
    members.map((m) => m.id),
  );
  return members.map((member) => ({
    ...member,
    lastSeenAt: lastSeenByMember.get(member.id),
    instrumentIds: (instrumentsByMember.get(member.id) ?? []).map((i) => i.id),
  }));
}

/**
 * Every instrument, archived included — the admin multi-select needs
 * archived ones too, so a member who already holds one doesn't silently
 * lose it the next time this form round-trips (an option missing from a
 * `<select multiple>` can't stay selected).
 */
export async function listAllInstruments(db: Db): Promise<instrumentsRepo.Instrument[]> {
  return instrumentsRepo.list(db, { includeArchived: true });
}

/**
 * Replace-all write for one member's instruments — a separate form/intent
 * from `updateMember`'s role/status guard, since which instruments a member
 * plays isn't a self-demotion/last-admin concern and an admin should be
 * able to edit their own (unlike role/status, see the page's "This is you"
 * case).
 */
export async function updateMemberInstruments(
  db: Db,
  id: string,
  formData: FormData,
): Promise<void> {
  const instrumentIds = formData
    .getAll("instrumentIds")
    .map((v) => String(v))
    .filter(Boolean);
  await membersRepo.setInstruments(db, id, instrumentIds);
}

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
  const parsed = patchMemberSchema.safeParse({
    status: formData.get("status") || undefined,
    role: formData.get("role") || undefined,
  });
  if (!parsed.success) {
    return { kind: "invalid" };
  }

  // Self-demotion and last-admin lockout rules live in `@bandlib/core`
  // now, shared with `packages/api`'s identical PATCH route — see this
  // module's header comment.
  const result = await updateMemberWithGuards(db, id, actingMemberId, parsed.data);
  if (result.kind === "ok") {
    return { kind: "ok" };
  }
  return result;
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

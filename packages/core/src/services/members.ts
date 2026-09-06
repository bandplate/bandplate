// Member-management domain rules shared by every caller that can mutate a
// member's role/status — `packages/api`'s `PATCH /admin/members/:id` and
// `apps/web`'s `/admin/members` page. Both used to carry their own copy of
// this logic (a header comment on the web module claimed they "mirror"
// each other exactly); the API's copy never grew the self-demotion/
// last-admin guard at all, which meant the sole admin could demote or
// disable themselves via the JSON API with one authenticated request even
// after the web UI was locked down — see task-4-report.md "Fix round 2".
// Pushing the rule down here, with both layers calling it, makes that kind
// of divergence structurally impossible: there is exactly one place either
// layer can get this rule from.
import { type Db, membersRepo } from "@bandlib/db";
import { z } from "zod";

export const createMemberSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name.").max(200),
  // `.email()`, not just non-empty — a display-name typo in the email
  // field used to create a member who could never log in (the login flow
  // only ever accepts a real address to send a link to), with nothing at
  // creation time to catch it. `packages/api`'s copy of this schema used
  // to validate email as bare `min(1).max(320)`, letting the same mistake
  // through the JSON API even after the web form was tightened.
  email: z
    .string()
    .trim()
    .min(1, "Enter an email address.")
    .max(320)
    .email("Enter a valid email address."),
  role: z.enum(["member", "admin"]).optional(),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const patchMemberSchema = z
  .object({
    status: z.enum(["invited", "active", "disabled"]).optional(),
    role: z.enum(["member", "admin"]).optional(),
  })
  .refine((v) => v.status !== undefined || v.role !== undefined, {
    message: "At least one of status or role is required.",
  });

export type PatchMemberInput = z.infer<typeof patchMemberSchema>;

export type UpdateMemberResult =
  | { kind: "ok"; member: membersRepo.Member }
  | { kind: "not_found" }
  // A caller (crafted request or otherwise) tried to change their own
  // role/status. `/setup` 404s once any member exists, so there is no
  // self-service way back in from a self-inflicted lockout — refuse the
  // change outright rather than let it land.
  | { kind: "self" }
  // The patch would leave zero admins able to sign in.
  | { kind: "last_admin" };

/**
 * Apply a role/status patch to a member, enforcing the two lockout rules
 * every caller must get: a member can never change their own role/status
 * (`actingMemberId === id`), and a patch that would demote or disable the
 * last remaining admin is refused.
 *
 * `actingMemberId` is `undefined` when the caller isn't a member at all
 * (a service token) — such a caller can never match `id` by construction,
 * so the self-check is simply a no-op for it, not a bypass.
 */
export async function updateMemberWithGuards(
  db: Db,
  id: string,
  actingMemberId: string | undefined,
  patch: PatchMemberInput,
): Promise<UpdateMemberResult> {
  if (actingMemberId !== undefined && id === actingMemberId) {
    return { kind: "self" };
  }

  const existing = await membersRepo.getById(db, id);
  if (!existing) {
    return { kind: "not_found" };
  }

  const nextRole = patch.role ?? existing.role;
  const nextStatus = patch.status ?? existing.status;
  const demotesOrDisablesAnAdmin =
    existing.role === "admin" && (nextRole !== "admin" || nextStatus === "disabled");

  if (demotesOrDisablesAnAdmin) {
    // Cheap at this scale (a band roster, not a userbase) — list every
    // member rather than maintaining a running admin count. An admin whose
    // status is "invited" can still sign in — the only login gate is
    // `status !== "disabled"` (see `services/auth.ts`) — so this counts
    // every non-disabled admin, not just "active" ones; an invited
    // co-admin is a real recovery path and must count as one.
    const allMembers = await membersRepo.list(db);
    const otherEligibleAdmins = allMembers.filter(
      (m) => m.id !== id && m.role === "admin" && m.status !== "disabled",
    );
    if (otherEligibleAdmins.length === 0) {
      return { kind: "last_admin" };
    }
  }

  const update: membersRepo.UpdateMemberInput = {};
  if (patch.status !== undefined) {
    update.status = patch.status;
  }
  if (patch.role !== undefined) {
    update.role = patch.role;
  }
  await membersRepo.update(db, id, update);

  const updated = await membersRepo.getById(db, id);
  if (!updated) {
    return { kind: "not_found" };
  }
  return { kind: "ok", member: updated };
}

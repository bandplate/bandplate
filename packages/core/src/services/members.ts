import { type Db, membersRepo } from "@bandplate/db";
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
import type { Locale } from "@bandplate/i18n";
import { z } from "zod";
import { buildInviteMessage } from "../mail-messages.js";
import type { Mailer } from "../ports/mailer.js";

export const createMemberSchema = z.object({
  displayName: z.string().trim().min(1, "displayNameRequired").max(200),
  // `.email()`, not just non-empty — a display-name typo in the email
  // field used to create a member who could never log in (the login flow
  // only ever accepts a real address to send a link to), with nothing at
  // creation time to catch it. `packages/api`'s copy of this schema used
  // to validate email as bare `min(1).max(320)`, letting the same mistake
  // through the JSON API even after the web form was tightened.
  email: z.string().trim().min(1, "emailRequired").max(320).email("emailInvalid"),
  role: z.enum(["member", "admin"]).optional(),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const patchMemberSchema = z
  .object({
    status: z.enum(["invited", "active", "disabled"]).optional(),
    role: z.enum(["member", "admin"]).optional(),
  })
  .refine((v) => v.status !== undefined || v.role !== undefined, {
    message: "statusOrRoleRequired",
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

// ---------------------------------------------------------------------------
// sendMemberInvite
// ---------------------------------------------------------------------------

/**
 * Bounds the send so a wedged mail provider cannot hang the admin's request.
 * Local copy rather than an import from `services/auth.ts`: that module's is
 * private, and exporting it to share eight lines would put a timing helper in
 * the package's public surface for no one else's benefit.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const DEFAULT_INVITE_MAIL_TIMEOUT_MS = 8_000;

export interface SendMemberInviteDeps {
  mailer: Mailer;
  /** The app's own origin. The invite points at `${appOrigin}/login`. */
  appOrigin: string;
  inviteMailTimeoutMs?: number;
}

/**
 * Tell someone they have been added to the band's archive.
 *
 * Deliberately carries NO login token. A login token lives fifteen minutes and
 * is single-use, which is right for a link someone asked for thirty seconds
 * ago and useless for one that lands in an inbox they may not open until
 * tomorrow — an invitation built on one would be dead on arrival for most of
 * the people who get it, and lengthening the TTL for this case would put a
 * long-lived credential in a mailbox for the sake of a convenience.
 *
 * So the invitation is a NOTIFICATION, not a credential: it says the address
 * is now on the whitelist and where to go to get a link of their own. That
 * also makes re-sending it free and safe, which is what an admin fielding
 * "I never got it" actually needs.
 *
 * Returns whether the mail went out. Creating the member must not fail because
 * the mailer is misconfigured — the member IS created and can sign in without
 * ever seeing this email — but the admin has to be told, or a broken mail
 * pipeline is discovered by the person who cannot get in.
 */
export async function sendMemberInvite(
  deps: SendMemberInviteDeps,
  member: { displayName: string; email: string; locale?: Locale },
  /**
   * The admin who pressed the button, by display name — so the mail says who
   * it is from rather than "an admin of your band". Optional, because nothing
   * about creating a member depends on knowing this and a caller without an
   * acting member (a script, a future automated path) must still be able to
   * send the invitation.
   */
  invitedBy?: string,
): Promise<boolean> {
  // `?email=` is what makes the button one press rather than "now type the
  // address this mail was sent to". `/login` reads it, fills the field and
  // locks it: an invite is bound to ONE address, and a different one there
  // would be answered with the same non-committal "if that address is
  // registered…" as everything else — a link that never arrives, and no way
  // to tell why. The page still offers `/login` with no parameter for anyone
  // who really does want another address.
  const signInUrl = `${deps.appOrigin.replace(/\/+$/, "")}/login?email=${encodeURIComponent(member.email)}`;

  try {
    await withTimeout(
      // The words and the styling live in `mail-messages.ts`, alongside the
      // sign-in message. This used to be a bare text-only body built inline —
      // which meant a member's FIRST mail from the app looked nothing like
      // their second, and the two drifted independently.
      deps.mailer.send(
        buildInviteMessage({
          to: member.email,
          displayName: member.displayName,
          signInUrl,
          invitedBy,
          // The new member's own row. It carries the column default until
          // they pick a language themselves — there is no better guess to
          // make about someone who has never signed in.
          locale: member.locale,
        }),
      ),
      deps.inviteMailTimeoutMs ?? DEFAULT_INVITE_MAIL_TIMEOUT_MS,
    );
    return true;
  } catch {
    return false;
  }
}

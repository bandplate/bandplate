// Who gets told what — pure filtering, no I/O.
//
// The tick already has the whole member list and a batch prefs lookup
// (`notificationPrefsRepo.listForMembers`) in hand before it gets here; this
// only decides, given that data, which members are in scope for ONE kind of
// notification.
import { notificationPrefsRepo } from "@bandplate/db";
import type { Locale } from "@bandplate/i18n";

type NotificationPrefs = notificationPrefsRepo.NotificationPrefs;

/** The three toggles `notification_prefs` stores, doubling as the three things bandplate ever pushes about. */
export type NotificationType = "newTakes" | "weeklyUnvoted" | "songChanges";

/**
 * The active members who should hear about a `type` notification right now.
 *
 * - Only `status === "active"` members are ever recipients — an invited
 *   member has no working sign-in yet, and a disabled one shouldn't hear
 *   from the band at all.
 * - A member with no row in `prefs` has never touched `/me`'s notification
 *   section, which means nothing was ever turned off — see
 *   `notificationPrefsRepo.get`'s identical "no row = all on" rule.
 * - `exclude` drops specific ids regardless of the above — e.g. the member
 *   whose own upload or edit triggered the notification, who doesn't need
 *   to be told about their own action.
 */
export function selectRecipients(
  members: { id: string; status: string; locale: Locale }[],
  prefs: Map<string, NotificationPrefs>,
  type: NotificationType,
  exclude: ReadonlySet<string> = new Set(),
): { id: string; locale: Locale }[] {
  return members
    .filter((member) => member.status === "active")
    .filter((member) => !exclude.has(member.id))
    .filter(
      (member) => (prefs.get(member.id) ?? notificationPrefsRepo.DEFAULT_NOTIFICATION_PREFS)[type],
    )
    .map((member) => ({ id: member.id, locale: member.locale }));
}

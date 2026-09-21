// The scheduler's entry point: one call every 10 minutes, claiming
// whatever pending work exists and
// sending the pushes it decides on. Claim first, then send — per
// `notificationsRepo`'s own doc comments, a crash between the two loses a
// notification rather than repeating it.
//
// Every section (new takes, songs, weekly) is independent of the others and
// wrapped in its own `try`/`catch`: one section's failure (or one item's,
// within a section) must never stop the rest of the tick from running.
import {
  type Db,
  eventsRepo,
  membersRepo,
  notificationPrefsRepo,
  notificationsRepo,
  pushSubscriptionsRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import type { Locale } from "@bandplate/i18n";
import type { Clock } from "../ports/clock.js";
import type { PushMessage, PushSender, PushTarget } from "../ports/push.js";
import { isAllowedPushEndpoint } from "./endpoint.js";
import { encodePayload, newTakesMessage, songMessage, weeklyMessage } from "./messages.js";
import { isBatchStale, NEW_TAKES_QUIET_MS } from "./new-takes.js";
import { selectRecipients } from "./recipients.js";
import { weeklyReminderSlot } from "./schedule.js";
import { SONG_MAX_AGE_MS, SONG_THROTTLE_MS, songNotificationKind } from "./songs.js";

export interface NotificationTickDeps {
  db: Db;
  clock: Clock;
  push: PushSender;
  vapidKeyId: string;
  log?: (line: string) => void;
}

export interface NotificationTickResult {
  sent: number;
  gone: number;
  failed: number;
  skippedStale: number;
}

// TTLs from the spec's Constants list: 24h for takes/songs, 12h for weekly.
const TAKES_TTL_SECONDS = 86_400;
const SONG_TTL_SECONDS = 86_400;
const WEEKLY_TTL_SECONDS = 43_200;

type Recipient = { id: string; locale: Locale };

function newResult(): NotificationTickResult {
  return { sent: 0, gone: 0, failed: 0, skippedStale: 0 };
}

/**
 * Sends one message (built per-recipient, since it carries their locale) to
 * every subscription belonging to `recipients`. Handles the per-subscription
 * housekeeping the brief specs: a subscription minted under a different
 * VAPID key, or whose endpoint isn't an allowed push host, is deleted
 * without sending; `ok` marks success, `gone` deletes, `failed` only logs
 * (the subscription might still be good next time).
 */
async function sendToRecipients(
  deps: NotificationTickDeps,
  recipients: Recipient[],
  buildMessage: (locale: Locale) => PushMessage,
  ttlSeconds: number,
  result: NotificationTickResult,
): Promise<void> {
  if (recipients.length === 0) {
    return;
  }
  const localeByMember = new Map(recipients.map((r) => [r.id, r.locale]));
  const subs = await pushSubscriptionsRepo.listForMembers(
    deps.db,
    recipients.map((r) => r.id),
  );

  for (const sub of subs) {
    try {
      if (sub.vapidKeyId !== deps.vapidKeyId) {
        await pushSubscriptionsRepo.removeById(deps.db, sub.id);
        continue;
      }
      if (!isAllowedPushEndpoint(sub.endpoint)) {
        await pushSubscriptionsRepo.removeById(deps.db, sub.id);
        continue;
      }
      const locale = localeByMember.get(sub.memberId);
      if (!locale) {
        continue;
      }
      const message = buildMessage(locale);
      const payload = encodePayload(message);
      const target: PushTarget = { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth };
      const sendResult = await deps.push.send(target, payload, {
        ttlSeconds,
        topic: message.tag,
      });
      if (sendResult.kind === "ok") {
        result.sent++;
        await pushSubscriptionsRepo.markSuccess(deps.db, sub.id, deps.clock.now());
      } else if (sendResult.kind === "gone") {
        result.gone++;
        await pushSubscriptionsRepo.removeById(deps.db, sub.id);
      } else {
        result.failed++;
        deps.log?.(
          `push failed for subscription ${sub.id}: ${sendResult.reason ?? sendResult.status ?? "unknown"}`,
        );
      }
    } catch (err) {
      deps.log?.(`push send threw for subscription ${sub.id}: ${String(err)}`);
    }
  }
}

async function runNewTakesSection(
  deps: NotificationTickDeps,
  now: number,
  members: membersRepo.Member[],
  prefs: Map<string, notificationPrefsRepo.NotificationPrefs>,
  result: NotificationTickResult,
): Promise<void> {
  const batches = await notificationsRepo.listPendingTakeBatches(deps.db);
  for (const batch of batches) {
    try {
      const claimed = await notificationsRepo.claimTakeBatch(
        deps.db,
        batch.eventId,
        now,
        NEW_TAKES_QUIET_MS,
      );
      if (claimed.length === 0) {
        continue;
      }
      if (isBatchStale(batch.lastPublishedAt, now)) {
        result.skippedStale++;
        continue;
      }
      const event = await eventsRepo.getById(deps.db, batch.eventId);
      if (!event) {
        continue;
      }
      const recipients = selectRecipients(members, prefs, "newTakes");
      await sendToRecipients(
        deps,
        recipients,
        (locale) => newTakesMessage(locale, event, claimed.length, now),
        TAKES_TTL_SECONDS,
        result,
      );
    } catch (err) {
      deps.log?.(`new-takes section failed for event ${batch.eventId}: ${String(err)}`);
    }
  }
}

async function runSongsSection(
  deps: NotificationTickDeps,
  now: number,
  members: membersRepo.Member[],
  prefs: Map<string, notificationPrefsRepo.NotificationPrefs>,
  result: NotificationTickResult,
): Promise<void> {
  const pending = await notificationsRepo.listPendingSongChanges(deps.db, now, SONG_THROTTLE_MS);
  for (const change of pending) {
    try {
      const claimed = await notificationsRepo.claimSongNotification(
        deps.db,
        change.songId,
        change.prev,
        now,
      );
      if (!claimed) {
        continue;
      }
      const editsInWindow = await notificationsRepo.listSongChangesInWindow(
        deps.db,
        change.songId,
        change.prev,
        now,
      );
      const newestChangedAt = Math.max(...editsInWindow.map((e) => e.changedAt));
      if (now - newestChangedAt >= SONG_MAX_AGE_MS) {
        // The claim already went through above — honored silently, so it
        // can never be re-claimed and re-attempted, but nothing is sent for
        // a change this stale.
        result.skippedStale++;
        continue;
      }
      const editors = new Set(editsInWindow.map((e) => e.memberId));
      const kind = songNotificationKind(editsInWindow.map((e) => e.kind));
      const song = await songsRepo.getById(deps.db, change.songId);
      if (!song) {
        continue;
      }
      const recipients = selectRecipients(members, prefs, "songChanges", editors);
      await sendToRecipients(
        deps,
        recipients,
        (locale) => songMessage(locale, song, kind),
        SONG_TTL_SECONDS,
        result,
      );
    } catch (err) {
      deps.log?.(`song section failed for song ${change.songId}: ${String(err)}`);
    }
  }
}

async function runWeeklySection(
  deps: NotificationTickDeps,
  now: number,
  members: membersRepo.Member[],
  prefs: Map<string, notificationPrefsRepo.NotificationPrefs>,
  result: NotificationTickResult,
): Promise<void> {
  const slot = weeklyReminderSlot(now);
  if (!slot) {
    return;
  }
  const recipients = selectRecipients(members, prefs, "weeklyUnvoted");
  if (recipients.length === 0) {
    return;
  }
  const counts = await takesRepo.countUnvotedByMembers(
    deps.db,
    recipients.map((r) => r.id),
  );
  // A member with no subscription under the CURRENT VAPID key gets no
  // push either way, so claiming their Sunday slot anyway would burn it for
  // nothing: they subscribe later that same Sunday (or their only device
  // just rotated keys and hasn't re-subscribed yet) and the reminder never
  // arrives, this week or ever again for that slot. Fetching subscriptions
  // up front and skipping the claim entirely for members with none under
  // `deps.vapidKeyId` keeps the slot open for them instead.
  const subs = await pushSubscriptionsRepo.listForMembers(
    deps.db,
    recipients.map((r) => r.id),
  );
  const membersWithCurrentSubscription = new Set(
    subs.filter((sub) => sub.vapidKeyId === deps.vapidKeyId).map((sub) => sub.memberId),
  );
  for (const recipient of recipients) {
    try {
      if (!membersWithCurrentSubscription.has(recipient.id)) {
        continue;
      }
      const count = counts.get(recipient.id) ?? 0;
      if (count <= 0) {
        continue;
      }
      const claimed = await notificationsRepo.claimKey(
        deps.db,
        `weekly:${slot.dateKey}:${recipient.id}`,
        now,
      );
      if (!claimed) {
        continue;
      }
      await sendToRecipients(
        deps,
        [recipient],
        (locale) => weeklyMessage(locale, count),
        WEEKLY_TTL_SECONDS,
        result,
      );
    } catch (err) {
      deps.log?.(`weekly section failed for member ${recipient.id}: ${String(err)}`);
    }
  }
}

/** The scheduler's one entry point — see this module's header. */
export async function runNotificationTick(
  deps: NotificationTickDeps,
): Promise<NotificationTickResult> {
  const now = deps.clock.now();
  const result = newResult();

  let members: membersRepo.Member[];
  let prefs: Map<string, notificationPrefsRepo.NotificationPrefs>;
  try {
    members = await membersRepo.list(deps.db);
    prefs = await notificationPrefsRepo.listForMembers(
      deps.db,
      members.map((m) => m.id),
    );
  } catch (err) {
    // Nothing downstream can run without the member list — this is the one
    // failure that isn't "one section" or "one item", so it gets its own
    // early return rather than three sections each independently failing to
    // load the same thing. Still never throws: an unhandled rejection here
    // would be fatal to the Node scheduler's `setInterval`.
    deps.log?.(`failed to load members/prefs: ${String(err)}`);
    return result;
  }

  try {
    await runNewTakesSection(deps, now, members, prefs, result);
  } catch (err) {
    deps.log?.(`new-takes section failed: ${String(err)}`);
  }

  try {
    await runSongsSection(deps, now, members, prefs, result);
  } catch (err) {
    deps.log?.(`songs section failed: ${String(err)}`);
  }

  try {
    await runWeeklySection(deps, now, members, prefs, result);
  } catch (err) {
    deps.log?.(`weekly section failed: ${String(err)}`);
  }

  try {
    await notificationsRepo.prune(deps.db, now);
  } catch (err) {
    deps.log?.(`prune failed: ${String(err)}`);
  }

  return result;
}

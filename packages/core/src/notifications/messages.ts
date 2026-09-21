// The three push messages bandplate sends, and how they go on the wire.
//
// Mirrors `mail-messages.ts`'s split: this module decides WHAT a message
// says, in the recipient's own locale, using `@bandplate/i18n`'s `push`
// area for the words. It has no idea how a message gets delivered — that is
// `@bandplate/push`'s job, same as `@bandplate/mail`'s for `MailMessage`.
import { formatNumber, type Locale, pushMessages } from "@bandplate/i18n";
import type { PushMessage } from "../ports/push.js";
import { BAND_TIME_ZONE, zonedParts } from "./schedule.js";

/**
 * How many days past an event's own day a "new takes" notification will
 * still name it by weekday ("From Thursday's rehearsal") rather than by
 * date ("From the rehearsal on Sep 12"). Beyond this, "Thursday" stops
 * meaning anything to a reader who has to work out
 * which Thursday.
 */
const NEW_TAKES_WEEKDAY_HORIZON_DAYS = 6;

/** Whole calendar days between two Prague-local `YYYY-MM-DD` date keys — never a raw ms/86400000 divide, which drifts across a DST change. */
function calendarDaysBetween(laterDateKey: string, earlierDateKey: string): number {
  const laterUtcMidnight = Date.parse(`${laterDateKey}T00:00:00Z`);
  const earlierUtcMidnight = Date.parse(`${earlierDateKey}T00:00:00Z`);
  return Math.round((laterUtcMidnight - earlierUtcMidnight) / 86_400_000);
}

/** The "From Thursday's rehearsal" / "ze čtvrteční zkoušky" part, for an event with no title. */
function eventDescriptor(
  locale: Locale,
  event: { kind: string; heldAt: number },
  now: number,
): string {
  const t = pushMessages(locale);
  const eventParts = zonedParts(event.heldAt, BAND_TIME_ZONE);
  const nowParts = zonedParts(now, BAND_TIME_ZONE);
  const age = calendarDaysBetween(nowParts.date, eventParts.date);

  if (age > NEW_TAKES_WEEKDAY_HORIZON_DAYS) {
    const [, month, day] = eventParts.date.split("-").map(Number);
    return t.newTakesByDate(event.kind, day ?? 1, month ?? 1);
  }
  return t.newTakesByWeekday(event.kind, eventParts.weekday);
}

/** A push announcing new takes uploaded to one event. */
export function newTakesMessage(
  locale: Locale,
  event: { id: string; kind: string; title: string | null; heldAt: number },
  count: number,
  now: number,
): PushMessage {
  const t = pushMessages(locale);
  // `||`, not `??`: an event title that is present but empty (an admin
  // cleared the field rather than leaving it unset) is just as much "no
  // title" as `null` is — the weekday/date fallback is the only thing that
  // still names the event.
  const descriptor = event.title || eventDescriptor(locale, event, now);
  return {
    title: t.newTakesTitle,
    body: `${descriptor} (${formatNumber(locale, count)})`,
    url: `/events/${event.id}`,
    tag: `takes:${event.id}`,
  };
}

/** The weekly "N takes are waiting for your vote" reminder. */
export function weeklyMessage(locale: Locale, count: number): PushMessage {
  const t = pushMessages(locale);
  return {
    title: t.weeklyTitle,
    body: t.weeklyBody(count),
    url: "/takes?unvoted=1",
    tag: "weekly",
  };
}

/** A push announcing a song was created, or its chart changed. */
export function songMessage(
  locale: Locale,
  song: { slug: string; title: string },
  kind: "created" | "edited",
): PushMessage {
  const t = pushMessages(locale);
  return {
    title: kind === "created" ? t.songCreatedTitle : t.songEditedTitle,
    body: kind === "created" ? song.title : t.songEditedBody(song.title),
    url: `/songs/${song.slug}`,
    tag: `song:${song.slug}`,
  };
}

/** The wire's byte budget — a push service will reject anything larger, and some (notably APNs/web push) reject well before that. */
const MAX_PAYLOAD_BYTES = 3000;

const textEncoder = new TextEncoder();

/**
 * `PushMessage` as the JSON string that actually goes in the request body.
 * `v: 1` is a version tag for the service worker's payload parser, so a
 * future field can be added without the old and new shapes being
 * ambiguous.
 *
 * Throws rather than silently truncating when the encoded payload would
 * exceed `MAX_PAYLOAD_BYTES` — a push service failing the send with a clear
 * error at send time is far easier to diagnose than a notification that
 * silently lost its last few words of body text.
 */
export function encodePayload(m: PushMessage): string {
  const json = JSON.stringify({ v: 1, title: m.title, body: m.body, url: m.url, tag: m.tag });
  const bytes = textEncoder.encode(json).length;
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`push payload is ${bytes} bytes, over the ${MAX_PAYLOAD_BYTES}-byte limit`);
  }
  return json;
}

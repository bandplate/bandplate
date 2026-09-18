// The words bandplate PUSHES — a phone's lock screen, not a page. Shorter
// than mail, and with no HTML fallback at all: `title` and `body` are
// everything the reader sees, so nothing here is filler.
//
// See `packages/core/src/notifications/messages.ts` for how the transport
// assembles these (the event title, the take count, and the "(N)" suffix
// are all plain user data or arithmetic done there, not translated here).

const KIND_NOUN: Record<string, string> = {
  rehearsal: "rehearsal",
  concert: "concert",
  session: "session",
};

/** "Thursday's", "Friday's" — the possessive an untitled event's notification names its day with. */
const WEEKDAY_POSSESSIVE: Record<number, string> = {
  0: "Sunday's",
  1: "Monday's",
  2: "Tuesday's",
  3: "Wednesday's",
  4: "Thursday's",
  5: "Friday's",
  6: "Saturday's",
};

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const push = {
  // --- new takes -------------------------------------------------------
  newTakesTitle: "New takes",
  /**
   * An untitled event, named by its kind and the weekday it fell on in
   * Prague — "From Thursday's rehearsal". `weekday` follows `zonedParts`:
   * 0 = Sunday.
   *
   * An unrecognised `kind` passes through as itself, same rule as
   * `events.kindLabel` — `events.kind` is admin-editable vocabulary at the
   * schema level even though today's enum only has three values.
   */
  newTakesByWeekday: (kind: string, weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6): string =>
    `From ${WEEKDAY_POSSESSIVE[weekday]} ${KIND_NOUN[kind] ?? kind}`,
  /** An untitled event more than 6 days old, named by its kind and date instead of its weekday. */
  newTakesByDate: (kind: string, day: number, month: number): string =>
    `From the ${KIND_NOUN[kind] ?? kind} on ${MONTH_ABBR[month - 1] ?? String(month)} ${day}`,

  // --- weekly unvoted reminder ------------------------------------------
  weeklyTitle: "Takes waiting for your vote",
  weeklyBody: (count: number): string =>
    `${count} ${count === 1 ? "take is" : "takes are"} waiting for your vote.`,

  // --- song changes -------------------------------------------------------
  songCreatedTitle: "New song",
  songEditedTitle: "Song updated",
  songEditedBody: (title: string): string => `Chords or lyrics: ${title}`,
};

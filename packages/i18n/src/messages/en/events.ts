// Words about events, shared by home, `/events`, `/takes` and a take's own
// page — anywhere a rehearsal, concert or studio date is named.
import { plural } from "../../plural.js";

/**
 * The one word a row shows for an event's kind.
 *
 * `concert` reads as "live" because that is what the band calls it; the other
 * two are already the word they would use.
 *
 * ANYTHING UNRECOGNISED PASSES THROUGH AS ITSELF. `events.kind` is a plain
 * `string` in the schema — an admin-editable vocabulary was always the intent
 * — so a kind this map has never heard of renders as whatever the admin typed
 * rather than as a fallback that would hide it. That is why this is a function
 * with a lookup inside rather than a `Record`: a `Record` would have to be
 * total, and this deliberately is not.
 */
const KIND_WORDS: Record<string, string> = {
  rehearsal: "rehearsal",
  concert: "live",
  session: "session",
  /** A member's own recordings, published from their stash. */
  personal: "personal",
};

export const events = {
  kindLabel: (kind: string): string => KIND_WORDS[kind] ?? kind,

  /**
   * An event with no venue and no title.
   *
   * "Unnamed", not an em dash: most rehearsals have neither, and a column of
   * dashes reads as missing data rather than as the normal case.
   */
  unnamed: "Unnamed",

  /** The ledger's footer button on home. */
  allEvents: "All events",

  /** A personal event's hero — who recorded it. */
  recordedByLabel: "Recorded by",

  /**
   * A personal recording's event, where no kind column sits beside the name to
   * say it (home's pinned hero): whose personal recordings these are.
   */
  personalOf: (owner: string): string => `Personal recordings, ${owner}`,

  /** "3 takes" — the count under a plate, and in the ledger. */
  takeCount: (count: number): string =>
    `${count} ${plural("en", count, { one: "take", other: "takes" })}`,

  // --- the archive ---------------------------------------------------------
  title: "Events",
  addEvent: "Add event",
  addEventEyebrow: "New event",
  addEventTitle: "Add an event",
  addEventSubtitle: "A rehearsal, a concert, or a studio session — whatever the takes came from.",

  kindRehearsal: "Rehearsal",
  kindConcert: "Concert",
  kindSession: "Session",
  filterRehearsals: "Rehearsals",
  filterConcerts: "Concerts",
  filterSessions: "Sessions",

  dateLabel: "Date",
  venueLabel: "Venue",
  venueHint: "Where you played. Leave it empty for the usual room.",
  titleLabel: "Title",
  titleHint: "Only if it had a name — most rehearsals don't.",
  notesLabel: "Notes",
  cancel: "Cancel",
  saveChanges: "Save changes",

  emptyFiltered: "Nothing of that kind yet — turn another one back on.",
  empty: "No events yet — they'll show up here once a rehearsal or show is logged.",

  // --- one event -----------------------------------------------------------
  archivedBanner: "Archived",
  archivedDone: "Archived. It's out of the archive; its takes are untouched.",
  created: "Added. Takes recorded that day go here.",
  saved: "Saved.",
  gone: "That event is no longer here.",
  takeGone: "That's no longer here — reload and try again.",
  takeDeleted: "Take deleted, along with its files.",
  merged: "Merged. Everything is on this one now.",

  duplicateWarnTitle: "There was already one that day",
  duplicateFiledTwiceTitle: "This day is filed twice",
  mergeConfirmTitle: "Move the other one's takes here?",
  mergeConfirmBody:
    "Its takes move across, keeping their songs, their files and their votes. The emptied event is archived rather than deleted, and this one takes over the key the bridge files against.",
  mergeCta: "Merge them",
  openTheOther: "Open the other one",
  moveTakesHere: "Move its takes here",

  /**
   * The two duplicate warnings.
   *
   * Both interpolate a kind and a date and both are whole paragraphs, so they
   * are functions rather than fragments assembled in the template — the kind
   * lands in a different place in each language.
   */
  duplicateWarnBody: ({ kind, date }: { kind: string; date: string }): string =>
    `Another ${kind} is filed on ${date}. That's fine if you really played twice — but if this is the same session, use the one that was already there, or the bridge will file its takes against it and leave this one empty.`,
  duplicateFiledTwiceBody: ({ kind, date }: { kind: string; date: string }): string =>
    `Another ${kind} sits on ${date}. If you both played twice that's right — but if it's the same session, the takes are split between them and the bridge will keep filing against whichever one holds its key.`,

  editEyebrow: "Editing event",
  editSubtitle: "Only the date and the kind are required.",

  addTakeEyebrow: "New take",
  addTakeTitle: "Add a take",
  addTakeSubtitle: "It goes on this session; the audio comes afterwards.",
  recordedLabel: "Recorded",
  takeLabelLabel: "Label",
  takeLabelHint: "Which pass it was — take 3, with the horns. Optional.",

  archiveThis: "Archive this event",
  putItBack: "Put it back",
  /** The kind picker's own label on the edit sheet. */
  whatWasIt: "What was it",
  archived: "Archived",
  edit: "Edit",
  /** The button that starts the queue from this event's own take list. */
  playAll: "Play all",
  addTake: "Add take",
  instrumentsHeading: "Instruments",
  songHeading: "Song",

  takesHeading: "Takes",
  takesEmpty: "No takes logged for this one yet.",
  /** The take list's own subheading, which says what its order means. */
  takesInOrder: (count: number): string =>
    `${count} ${plural("en", count, { one: "take", other: "takes" })}, in the order they were played`,

  /**
   * Naming an event inside a question.
   *
   * The kind and the date arrive as separate parts because English and Czech
   * put them together differently — and, more importantly, because
   * `kindLabel` PASSES UNKNOWN KINDS THROUGH. An admin can add "jam", so no
   * language may assume it can decline the word it is given. English can say
   * "the rehearsal of 8 July"; Czech cannot inflect an unknown noun, so its
   * version keeps the kind nominative after a colon.
   */
  unarchiveConfirmTitle: ({ kind, date }: { kind: string; date: string }): string =>
    `Put the ${kind} of ${date} back?`,
  unarchiveConfirmBody: "It returns to the event archive and to home.",
  unarchiveCta: "Unarchive event",
  archiveConfirmTitle: ({ kind, date }: { kind: string; date: string }): string =>
    `Archive the ${kind} of ${date}?`,
  archiveCta: "Archive event",
  /**
   * The object of the archive question, named on its own.
   *
   * The confirm PAGE builds its heading around this ("Archive the rehearsal
   * of 8 July 2026?"), while the dialog uses the whole question above. Same
   * parts, same rule about not inflecting an unknown kind.
   */
  archiveConfirmWhat: ({ kind, date }: { kind: string; date: string }): string =>
    `the ${kind} of ${date}`,

  /**
   * What archiving costs — the sibling of `songs.archiveConsequence`, shared
   * by the confirm dialog and the confirm page for the same reason.
   */
  archiveConsequence: ({ takeCount }: { takeCount: number }): string => {
    const head = "It disappears from the event archive and from home.";
    const takes =
      takeCount === 0
        ? ""
        : takeCount === 1
          ? " Its one take stays and keeps playing — you'll reach it from its song."
          : ` Its ${takeCount} takes stay and keep playing — you'll reach them from their songs.`;
    return `${head}${takes} You can put it back any time.`;
  },
};

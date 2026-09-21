// `/takes` (the archive and its filters) and `/takes/[id]` (one take).
import { plural } from "../../plural.js";

export const takes = {
  // --- the archive ---------------------------------------------------------
  title: "Takes",
  count: (total: number): string =>
    `${total} ${plural("en", total, { one: "take", other: "takes" })}`,
  filtered: "filtered",

  filters: "Filters",
  filtersClose: "Close filters",
  clear: "Clear filters",
  showTakes: "Show takes",

  songLabel: "Song",
  anySong: "Any song",
  instrumentsLegend: "Instruments",
  /** Appended to the legend when more than one is picked — the filter is AND, not OR. */
  instrumentsAll: "— all of these",

  recordedLegend: "Recorded",
  anyTime: "Any time",
  pastWeek: "Past week",
  pastMonth: "Past month",
  past3Months: "Past 3 months",
  pastYear: "Past year",
  exactDates: "Exact dates",
  recordedFrom: "Recorded from",
  recordedTo: "Recorded to",
  exactDatesNote: "A date here is used instead of the choice above.",

  yoursLegend: "My votes",
  notVotedByMe: "Not voted yet",

  sortLabel: "Sort by",
  sortRecent: "Most recent",
  sortRating: "Most keeper votes",

  emptyFiltered: "No takes match those filters — try turning one off.",
  empty: "No takes in the archive yet.",

  // --- one take ------------------------------------------------------------
  /** The page title. A take has no name of its own, so it borrows its song's. */
  pageTitle: (songTitle: string): string => `Take of ${songTitle}`,
  pageTitleUnknown: "Take",

  /**
   * The hero's one line about where this take came from.
   *
   * Three shapes, because the kind is a WORD from an admin-editable
   * vocabulary and only one of them can take it: where the event has a name
   * the name carries the sentence; where it does not, the kind becomes an
   * adjective on the take ("A rehearsal take"), which stays grammatical for
   * any value the vocabulary holds — including one added later.
   */
  heroFromEvent: ({ event, date }: { event: string; date: string }): string =>
    `A take from ${event}, ${date}`,
  heroOfKind: ({ kind, date }: { kind: string; date: string }): string => `A ${kind} take, ${date}`,
  heroRecorded: (date: string): string => `Recorded ${date}`,
  /** A take of no known song borrows its date for a title. */
  heroTitleByDate: (date: string): string => `Take from ${date}`,

  saved: "Saved.",
  fileDeleted: "File deleted.",
  gone: "That take is no longer here.",
  songGone: "That song is no longer here — reload and pick another.",

  nothingToPlayTitle: "Nothing left to play",
  nothingToPlayBody: "This take is published but has no playable file. Add one, or unpublish it.",
  published: "Published. The band can find it now.",
  unpublished: "Unpublished. Only someone with the link will find it.",
  publishBlocked:
    "There's nothing on this take that can be played yet, so there's nothing to publish.",

  draftEyebrow: "Not published yet",
  draftReady: "Nobody will find this take until you publish it.",
  draftNotReady: "Put something on it that can be played, and you'll be able to publish it.",
  publishTake: "Publish take",
  unpublishThisTake: "Unpublish this take",

  listenHeading: "Listen",
  yourVoteHeading: "Your vote",
  instrumentsHeading: "Instruments",
  /** The labels over the facts panel under a take's phone header. */
  panelEventLabel: "Event",
  lengthLabel: "Length",
  /** The band's ruling on the take: keeper or rejected. */
  verdictLabel: "Verdict",
  songHeading: "Song",

  playThisTake: "Play this take",
  /** A stem whose instrument row has gone. */
  unknownInstrument: "Unknown instrument",
  masterLabel: "Master",
  losslessMaster: "lossless master",
  masterMix: "master mix",

  editEyebrow: "Editing take",
  edit: "Edit",
  recordedLabel: "Recorded",
  takeLabelLabel: "Label",
  takeLabelHint:
    "Which pass it was — take 3, with the horns. Leave it empty if there's nothing to say.",
  notesLabel: "Notes",
  saveChanges: "Save changes",
  cancel: "Cancel",

  takeAdded: "Take added. Nobody will find it until there's something to play and you publish it.",
  /** The favorite star's object name when the take has no song title. */
  thisTake: "this take",
  losslessYes: "A lossless master is available.",
  losslessNo: "No lossless master available yet.",

  noAssets: "No assets uploaded for this take yet.",
  /** The column heads of a take's file table. */
  fileColumn: "File",
  formatColumn: "Format",
  tierColumn: "Quality",
  sizeColumn: "Size",
  deleteFile: "Delete file",
  /** The download and delete controls on one asset row, which have no visible text. */
  downloadAsset: ({
    label,
    format,
    size,
  }: { label: string; format: string; size: string }): string =>
    `Download ${label} (${format}, ${size})`,
  deleteAsset: (label: string): string => `Delete ${label}`,
  deleteAssetConfirmTitle: (label: string): string => `Delete the ${label} from this take?`,
  deleteTake: "Delete take",
  deleteThisTake: "Delete this take",

  keeperCta: "Promote to keeper",
  keeperBody: "This take will be marked keeper — the band's pick for this song at this event.",
  rejectCta: "Reject",
  rejectBody:
    "This take will be marked rejected and dropped from 'needs your vote'. It stays in the archive.",

  /**
   * Deleting a take. Unlike archiving, this one has no reassurance to offer.
   *
   * It says the number of files and their total size because "5 files,
   * 312 MB" is the fact that makes someone stop and check, and it names the
   * votes because those are the band's work, not the uploader's. `byteTotal`
   * arrives formatted — the catalog takes primitives only.
   */
  deleteConsequence: ({
    fileCount,
    byteTotal,
    totalVotes,
  }: {
    fileCount: number;
    byteTotal: string;
    totalVotes: number;
  }): string => {
    const files =
      fileCount === 0
        ? "It has no files yet."
        : `It permanently removes ${fileCount} ${plural("en", fileCount, { one: "file", other: "files" })} (${byteTotal}).`;
    const votes =
      totalVotes === 0
        ? ""
        : ` The ${totalVotes} ${plural("en", totalVotes, { one: "vote", other: "votes" })} cast on it ${plural("en", totalVotes, { one: "goes", other: "go" })} too.`;
    return `This can't be undone. ${files}${votes} The song and the event stay.`;
  },

  /** What deleting one file costs — shared by the confirm dialog and its page. */
  deleteAssetConsequence: ({
    label,
    format,
    tier,
    bytes,
    isLastPlayable,
  }: {
    label: string;
    format: string;
    tier: string;
    bytes: string;
    isLastPlayable: boolean;
  }): string => {
    const head = `This can't be undone. It removes the ${label} (${format}, ${tier}, ${bytes}) from storage.`;
    return isLastPlayable
      ? `${head} It is the only thing this take can be played from, so the take will have nothing to play.`
      : `${head} The take keeps its other files.`;
  },
  /** Beside a listed take while the player is on it. Lower case: it reads as part of the row's second line. */
  nowPlaying: "playing",
};

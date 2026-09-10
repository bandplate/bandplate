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
  clear: "Clear",
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

  yoursLegend: "Yours",
  notVotedByMe: "Not voted by me",

  sortLabel: "Sort by",
  sortRecent: "Most recent",
  sortRating: "Most keeper votes",

  emptyFiltered: "No takes match those filters — try turning one off.",
  empty: "No takes in the archive yet.",

  // --- one take ------------------------------------------------------------
  /** The page title. A take has no name of its own, so it borrows its song's. */
  pageTitle: (songTitle: string): string => `Take of ${songTitle}`,
  pageTitleUnknown: "Take",

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
  adminHeading: "Admin",
  songHeading: "Song",

  playThisTake: "Play this take",
  soloAnInstrument: "Solo an instrument",
  fullMix: "Full mix",
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

  noAssets: "No assets uploaded for this take yet.",
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
};

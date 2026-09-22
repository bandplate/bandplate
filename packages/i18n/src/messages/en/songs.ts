// `/songs` and `/songs/[slug]` — the library, and one song's page.
import { plural } from "../../plural.js";

export const songs = {
  // --- the library ---------------------------------------------------------
  title: "Songs",
  addSong: "Add song",
  addSongEyebrow: "New song",
  addSongTitle: "Add a song",
  addSongSubtitle: "A title is all you need — the rest can wait until someone knows it.",

  titleLabel: "Title",
  keyLabel: "Key",
  keyHint: "However you say it — Am, F# dorian.",
  tempoLabel: "Tempo",
  tempoHint: "Beats per minute.",
  notesLabel: "Notes",
  notesHint: "Anything the band needs to remember about playing it.",
  cancel: "Cancel",

  searchLabel: "Search song titles",
  searchPlaceholder: "Search titles",
  searchSubmit: "Search",

  sortTitle: "A to Z",
  sortRecent: "Recently played",
  sortTakes: "Most takes",
  archived: "Archived",

  /**
   * The count under the filters.
   *
   * Three shapes rather than one with flags, because they are three different
   * sentences: a search REPORTS a result, the archive NAMES a subset, and the
   * plain case is a bare count. English happens to make two of them look
   * similar; Czech does not.
   */
  countPlain: (count: number): string =>
    `${count} ${plural("en", count, { one: "song", other: "songs" })}`,
  countMatching: (count: number): string =>
    `${count} ${plural("en", count, { one: "song matches", other: "songs match" })}`,
  countArchived: (count: number): string =>
    `${count} archived ${plural("en", count, { one: "song", other: "songs" })}`,

  /** Flash banners the library shows after a redirect from a confirm page. */
  archivedBannerDone: "Archived. It's out of the library; its takes are untouched.",
  unarchivedDone: "Back in the library.",
  deletedDone: "Song deleted, along with its takes and their files.",

  emptySearch: "No songs match that search.",
  emptyArchive: "Nothing archived.",
  empty: "No songs yet. Add one, or wait for the first takes to come in.",

  /** A song row with neither a key nor a tempo recorded. */
  noKeyOrTempo: "No key or tempo",
  /** The tempo unit, appended to a number. */
  bpm: (tempo: number): string => `${tempo} bpm`,

  // --- one song ------------------------------------------------------------
  archivedBanner: "Archived",
  unarchiveConfirmTitle: (title: string): string => `Put ${title} back?`,
  unarchiveConfirmBody: "It returns to the song library and to the picker when you add a take.",
  unarchiveCta: "Unarchive song",

  created: "Added. Fill in the rest whenever you like.",
  saved: "Saved.",
  gone: "That song is no longer here.",
  takeGone: "That's no longer here — reload and try again.",

  editEyebrow: "Editing song",
  editSubtitle: "Everything here is optional except the title.",
  slugHint: "The web address stays as it is — renaming won't break links anyone has.",

  addTakeEyebrow: "New take",
  addTakeTitle: "Add a take",
  addTakeSubtitle: "It goes on this song; the audio comes afterwards.",
  addTake: "Add take",
  /** The event picker on the add-take sheet. */
  eventPickLabel: "Session",
  recordedLabel: "Recorded",
  takeLabelLabel: "Label",
  takeLabelHint: "Which pass it was — take 3, with the horns. Optional.",

  chartHeading: "Chords & lyrics",
  chordsHeading: "Chords",
  lyricsHeading: "Lyrics",
  chartEmpty: "Nobody's written these down yet.",

  generalNotesHeading: "General notes",
  aliasesHeading: "Also known as",

  edit: "Edit",
  archiveThis: "Archive this song",
  deleteForGood: "Delete this song for good",
  putItBack: "Put it back",
  instrumentNotesHeading: "Notes by instrument",
  openInstead: "Open it instead",
  saveChanges: "Save changes",

  takesHeading: "Takes",
  takesEmpty: "No takes of this one yet — record a rehearsal and it'll show up here.",
  /** The fold under a song's first takes. */
  showMoreTakes: (count: number): string =>
    `Show ${count} more ${plural("en", count, { one: "take", other: "takes" })}`,
  showFewer: "Show fewer",

  archiveConfirmTitle: (title: string): string => `Archive ${title}?`,
  archiveCta: "Archive song",
  deleteConfirmTitle: (title: string): string => `Delete ${title} and everything under it?`,
  deleteCta: "Delete song",

  /**
   * The archive warning, said in TWO places — the JS confirm dialog's
   * `data-confirm-body` and the no-JS confirm page — so it must not drift into
   * two different promises about what happens to the takes.
   *
   * A song with no takes says nothing about takes: "Its 0 takes stay" is
   * technically true and reads like a bug.
   */
  archiveConsequence: ({ takeCount }: { takeCount: number }): string => {
    const head = "It disappears from the song library and from the picker when you add a take.";
    const takes =
      takeCount === 0
        ? ""
        : takeCount === 1
          ? " Its one take stays, keeps playing, and still turns up in search."
          : ` Its ${takeCount} takes stay, keep playing, and still turn up in search.`;
    const tail =
      " If the bridge uploads a take of it again it comes back on its own, and you can put it back by hand any time.";
    return `${head}${takes}${tail}`;
  },

  /**
   * Deleting, which has no reassurance to offer.
   *
   * It leads with the RECORDINGS, not the song, because that is the part
   * nobody expects: a song row is cheap, and the takes under it are the band's
   * actual work. `byteTotal` arrives already formatted, because formatting it
   * needs a locale this function does not take.
   */
  deleteConsequence: ({
    takeCount,
    fileCount,
    byteTotal,
  }: {
    takeCount: number;
    fileCount: number;
    byteTotal: string;
  }): string => {
    if (takeCount === 0) {
      return "This can't be undone. It has no takes, so nothing recorded is lost — the song itself goes, along with its aliases and notes.";
    }
    const takes = `${takeCount} ${plural("en", takeCount, { one: "take", other: "takes" })}`;
    const files =
      fileCount === 0
        ? ""
        : ` and ${fileCount} audio ${plural("en", fileCount, { one: "file", other: "files" })} (${byteTotal})`;
    return `This can't be undone. It permanently removes ${takes}${files}, every vote cast on them, and anyone's pin. Archive it instead if you only want it out of the library — that keeps every recording.`;
  },

  // --- validation ----------------------------------------------------------
  errTitleRequired: "Enter a title.",
  errTempoPositive: "Tempo has to be a positive number.",
  errTempoCeiling: "That tempo looks wrong — 400 bpm is the ceiling.",
};

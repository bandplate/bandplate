// The stash: a member's private recordings, the recorder that makes them, and
// the sheet that adds one to its song. Pages read it as `t.stash`; the two
// islands (`Recorder`, `StashPendingList`) import `stashMessages` directly.
import { plural } from "../../plural.js";

export const stash = {
  // --- the stash view on /takes -------------------------------------------
  pill: "Stash",
  /** The page's own title while the drawer is open, in the title-join shape. */
  viewTitle: (takes: string): string => `${takes} — stash`,
  // The same pill, once the stash is open: pressing it again closes the drawer
  // and puts the band's recordings back.
  pillClose: "Close stash",
  viewLede: "Recordings only you can see.",
  recordIdea: "Record an idea",
  /**
   * The same control on a phone, where the caption will not fit beside the
   * title and the close pill. The long caption stays as the accessible name,
   * so this is only ever read by the eye.
   */
  recShort: "REC",
  empty: "Your stash is empty. Record an idea and it lands here.",
  unknownSong: "Unknown song",
  /**
   * A recording whose member has not chosen a song for it. Both the name such
   * a recording goes by when it has no label of its own, and the picker's way
   * past the song: one phrase, one key.
   */
  noSongYet: "No song yet",
  chipWaiting: "Waiting for signal",
  chipSyncing: "Uploading",
  chipFailed: "Couldn't upload",
  retry: "Try again",
  discardPendingBody: "It is only on this device, so throwing it away loses it for good.",
  /**
   * The song page's own section of the member's recordings of that song,
   * under the band's takes. A section TITLE, so it is a name and not a
   * sentence: the count goes under the list (`songSectionCount`), which is
   * where the takes section above puts its own.
   */
  songSection: "In your stash",
  /**
   * How many, under that section's list — where the takes section above puts
   * its own. "recordings", not "takes": in the stash it is not a take yet,
   * and every other string here calls it a recording.
   */
  songSectionCount: (count: number): string =>
    `${count} ${plural("en", count, { one: "recording", other: "recordings" })}`,
  /** Home, above the recent events: the way into the stash, carrying its count. */
  showStash: "Show stash",

  // --- the recorder ---------------------------------------------------------
  close: "Close",
  stepOne: "Step 1 of 2",
  stepTwo: "Step 2 of 2",
  pickTitle: "Which song?",
  searchLabel: "Find a song",
  /** The picker's first group: the songs the band played most recently. */
  recentSongs: "Recent",
  allSongs: "All songs",
  noSongMatch: "No song matches that.",
  /** The stash item page: without a song there is nothing to add the recording TO. */
  noSongs: "The library has no songs yet. Add one first.",
  /**
   * The recorder's version of the same fact, which is not the same advice:
   * recording works with no library at all, so telling the member to go add a
   * song first would contradict the button underneath.
   */
  noSongsRecordAnyway:
    "The library has no songs yet. Record the idea anyway and file it when there is one.",
  recordFor: (title: string): string => `Record for ${title}`,
  /** The CTA when nothing is selected: record now, choose the song later. */
  recordWithoutSong: "Record without a song",
  recordingInto: "Recording into your stash",
  screenNote: "The screen may go dark; recording keeps going.",
  /** Under the level ring on the recording stage. */
  levelHint: "The ring shows your level. If it's full all the way round, you're too close.",
  start: "Start recording",
  stop: "Stop recording",
  cancel: "Cancel",
  timerLabel: "Recording length",
  discardQuestion: "Throw this recording away?",
  discard: "Throw away",
  keepRecording: "Keep recording",
  /**
   * The same question on the review screen, where the recording has already
   * stopped: keeping it means keeping the recording, not carrying on.
   */
  keepIt: "Keep it",
  finishing: "Finishing the recording",
  reviewPlay: "Play",
  reviewPause: "Pause",
  reviewSeek: "Jump to a point in the recording",
  labelField: "Label (optional)",
  labelPlaceholder: "e.g. an idea for the bridge",
  redo: "Again",
  save: "Save to stash",
  privateNote: "Only you will see it. You can add it to the song later from your stash.",
  errDenied:
    "The browser won't let the app use the microphone. Allow it in the site settings and try again.",
  errNoMic: "This device has no microphone.",
  errUnsupported: "This browser can't record audio.",
  errSaveFailed: "Couldn't keep the recording on this device. Try again.",

  // --- one stash item: its sheet, and the page behind it --------------------
  /** Above the recording's name in the sheet its row opens. */
  sheetEyebrow: "In your stash",
  pageTitle: (title: string): string => `${title} in your stash`,
  songAndLength: (title: string, length: string): string => `${title}, ${length}`,
  backToStash: "Back to the stash",
  addTitle: "Add to song",
  fieldSong: "Song",
  fieldEvent: "Event",
  fieldBy: "Recorded by",
  personalEvent: (date: string): string => `Personal recordings, ${date}`,
  publishNote:
    "The whole band will see it with the song. There's no vote on it and nobody gets notified.",
  publish: "Add to song",
  /** The picker on a recording that has no song, above "Add to song". */
  chooseSong: "Which song is this?",
  chooseSongPlaceholder: "Pick a song",
  noSongChosen: "Pick a song first, then add it.",
  songGone: "That song is not in the library any more.",
  stillUploading: "This recording is still on its way from the phone that made it.",
  rename: "Rename",
  renameSave: "Save",
  renamed: "Renamed.",
  labelTooLong: "That label is too long. 200 characters fit.",
  download: "Download",
  delete: "Delete",
  deleteTitle: (title: string): string => `Delete this recording: ${title}?`,
  deleteBody: "It's gone for good, file included. Nobody else ever saw it.",
  deleteCta: "Delete recording",
};

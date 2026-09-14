// The three islands that mount only on a detail page: the chart editor and
// the uploader on `/songs/[slug]` and `/takes/[id]`, and the confirm dialog
// that any page with a destructive control uses.
//
// Grouped rather than split three ways because they always ship together —
// `ConfirmDialog` is on every page that has an `AssetUploader` or a
// `ChartEditor`, and none of them is on home or the archive. The player and
// the vote toggle, which ARE on every page, stay in their own areas.
export const islands = {
  // --- ChartEditor ---------------------------------------------------------
  chartAddSection: "Add a section",
  chartRemove: "Remove",
  chartSectionNamePlaceholder: "Verse",
  chartChordsPlaceholder: "Am Dm7",
  chartLyricsPlaceholder: "The words for this section",
  chartChordsHeading: "Chords",
  chartLyricsHeading: "Lyrics",
  chartFormatHint: "One section per line:",
  chartFormatExample: "Verse: Am Dm7",

  /** A row with no name yet — "section 3". Used inside the labels below. */
  chartUnnamedSection: (index: number): string => `section ${index}`,
  chartSectionNameLabel: (index: number): string => `Section ${index} name`,
  chartMoveUp: (name: string): string => `Move ${name} up`,
  chartMoveDown: (name: string): string => `Move ${name} down`,
  chartRemoveRow: (name: string): string => `Remove ${name}`,
  chartChordsFor: (name: string): string => `Chords for ${name}`,
  chartWordsFor: (name: string): string => `Words for ${name}`,

  /**
   * The warning about section names the song page will not recognise.
   *
   * One function, not a sentence glued around a count in the template: the
   * subject and verb agree with the number, and Czech disagrees with English
   * about where the count goes.
   */
  chartUnknownNames: (count: number): string =>
    count === 1
      ? "One section has a name the song page won't recognise"
      : `${count} sections have a name the song page won't recognise`,

  // --- AssetUploader -------------------------------------------------------
  uploadAddFiles: "Add files",
  uploadFilesHeading: "Files",
  uploadFilesAdded: "Files added.",
  uploadAdding: (count: number): string => `Adding ${count} ${count === 1 ? "file" : "files"}.`,
  uploadRemove: "Remove",
  uploadReplace: "Replace it",
  uploadSkip: "Skip",
  uploadRetry: "Try again",
  uploadWhichInstrument: "Which instrument?",
  uploadInstrumentFor: (fileName: string): string => `Instrument for ${fileName}`,
  uploadMaster: "Master",
  uploadStem: "Stem",

  /** The per-file phases, in the order a file goes through them. */
  uploadPhaseReading: "Reading it",
  uploadPhaseStarting: "Starting",
  uploadPhaseChecking: "Checking it arrived",
  uploadPhaseDone: "Done",
  uploadPhaseAlreadyThere: "Already there",
  uploadPhaseUnfinished: "Didn't finish",
  uploadPhaseWaitingOnYou: "Waiting on you",
  uploadPhaseWaiting: "Waiting",

  uploadErrNotAudio: "Not audio this app stores — mp3, opus, flac or wav.",
  uploadErrGone: "That file is no longer available.",
  uploadErrConnection: "The connection dropped.",
  uploadErrStopped: "The upload was stopped.",
  uploadErrRefused: (status: number): string => `The file was refused (${status}).`,
  uploadErrRejected: "The server wouldn't take that file.",
  uploadErrUnfinished:
    "The upload didn't finish. Nothing was saved — it starts again from the beginning.",
  uploadErrGeneric: "Something went wrong.",

  // --- ConfirmDialog -------------------------------------------------------
  /**
   * Fallbacks only. Every real confirm passes its own title, body and CTA
   * through `data-confirm-*`, server rendered and therefore already
   * translated — these are what shows if one forgets.
   */
  confirmTitle: "Are you sure?",
  confirmBody: "This can't be undone.",
  confirmCta: "Confirm",
  confirmCancel: "Cancel",
  confirmWorking: "Working…",
  /** While the dialog asks the server what the action would actually cost. */
  confirmLoading: "Checking what this affects…",
  confirmFailed: "That didn't work. Try again.",
  confirmFailedStatus: (status: number): string =>
    `That didn't work (status ${status}). Try again.`,

  // --- CopyButton ----------------------------------------------------------
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Couldn't copy",
};

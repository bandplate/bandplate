// The stash: a member's private recordings, the recorder that makes them, and
// the sheet that adds one to its song. Pages read it as `t.stash`; the two
// islands (`Recorder`, `StashPendingList`) import `stashMessages` directly.
export const stash = {
  // --- the stash view on /takes -------------------------------------------
  pill: "Stash",
  viewLede: "Recordings only you can see.",
  recordIdea: "Record an idea",
  empty: "Your stash is empty. Record an idea and it lands here.",
  unknownSong: "Unknown song",
  chipWaiting: "Waiting for signal",
  chipSyncing: "Uploading",
  chipFailed: "Couldn't upload",
  retry: "Try again",
  discardPendingBody: "It is only on this device, so throwing it away loses it for good.",
  open: "Open",
  /** Under a song's takes: "In your stash: 2". */
  inYourStash: (count: number): string => `In your stash: ${count}`,
  /** Home, above the recent events. */
  homeLine: (count: number): string => `${count} in your stash`,

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
  noSongs: "The library has no songs yet. Add one first.",
  recordFor: (title: string): string => `Record for ${title}`,
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

  // --- one stash item: "Add to song" ----------------------------------------
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
  stillUploading: "This recording is still on its way from the phone that made it.",
  rename: "Rename",
  renameSave: "Save",
  renamed: "Renamed.",
  labelTooLong: "That label is too long. 200 characters fit.",
  download: "Download",
  delete: "Delete",
  deleteTitle: (title: string): string => `Delete this recording of ${title}?`,
  deleteBody: "It's gone for good, file included. Nobody else ever saw it.",
  deleteCta: "Delete recording",
};

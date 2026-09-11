// `/takes/[id]/mix` — every stem of one take running together.
//
// Its OWN area, not part of `takes`, for the reason `player.ts` gives: this
// is a `client:load` island's copy, and an island ships its imports. The
// mixer is one page; the take catalog is nine kilobytes.
export const mixer = {
  title: "Mixer",
  /** The link back, which is a full page load — see the page for why. */
  backToTake: "Back to the take",

  play: "Play",
  pause: "Pause",
  /** While the tracks buffer. Not a spinner's label — it says what is happening. */
  starting: "Lining the tracks up…",
  /** The scrub bar laid over the lanes. */
  seek: "Seek",

  /** Per-track controls. Each needs a real name: a row of identical squares is unusable without sight of it. */
  mute: (instrument: string): string => `Mute ${instrument}`,
  unmute: (instrument: string): string => `Unmute ${instrument}`,
  solo: (instrument: string): string => `Solo ${instrument}`,
  unsolo: (instrument: string): string => `Stop soloing ${instrument}`,
  volume: (instrument: string): string => `${instrument} volume`,
  /** The short glyphs on the buttons themselves. */
  muteShort: "M",
  soloShort: "S",

  muteMine: "Mute my instruments",
  unmuteMine: "Bring my instruments back",

  /**
   * The take's own mixed-down version, offered as a muted track so that A/B
   * against the reference is one press away.
   */
  fullMixNote: "The full mix, muted — unmute it to compare, not to play alongside.",

  /**
   * Instruments that were played on this take but have no isolated file.
   *
   * Named because muting cannot remove them, and without saying so the mixer
   * looks broken to the one person most likely to try it.
   */
  onlyInMaster: (instruments: string): string =>
    `Only in the full mix, so muting will not remove them: ${instruments}.`,

  /** Every track has to be ready before any of them starts, or they enter raggedly. */
  cantStart: "Couldn't start every track. Reload and try again.",
  trackFailed: (instrument: string): string => `${instrument} wouldn't load.`,

  /**
   * iOS routes this audio through a session the ringer switch silences, and
   * there is no reliable way to detect or override it from a web page. So it
   * is the first thing the page says when someone cannot hear anything.
   */
  silenceHint: "Hearing nothing on a phone? Check the silent switch.",

  noScript: "The mixer needs JavaScript. The take page plays each stem on its own without it.",
};

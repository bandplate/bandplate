// The persistent player bar, and the two words it says about a source.
//
// Its own area rather than part of `takes`, because `Player.tsx` is
// `client:load` on EVERY page — one shared `islands` module would ship the
// chart editor's copy to the whole app. See `messages/voting.ts`.
export const player = {
  /** What the master is called, on the switcher chip and in the announcement. */
  master: "Master",
  /**
   * The prefix on an isolated instrument.
   *
   * Said in two places that must agree: the take page's chips, server
   * rendered, and the player's own "now playing" announcement. It used to be
   * a literal in both, and the player then STRIPPED it back off with a regex
   * anchored on that exact English word, to name its switcher chip.
   *
   * (The regex is not written out here on purpose: a comment containing the
   * characters that close a block comment cannot contain them.)
   */
  solo: (instrument: string): string => `Solo: ${instrument}`,

  nowPlaying: (title: string): string => `Now playing: ${title}`,
  nowPlayingSource: ({ title, source }: { title: string; source: string }): string =>
    `Now playing: ${title} — ${source}`,

  play: (title: string): string => `Play ${title}`,
  pause: (title: string): string => `Pause ${title}`,
  back: (seconds: number): string => `Back ${seconds} seconds`,
  forward: (seconds: number): string => `Forward ${seconds} seconds`,
  changeSource: "Change source, currently",
  sourceGroup: "Source",
  close: "Stop and close the player",
  seek: "Seek",
  /**
   * The way into the mixer, from the bar and from a take's own page.
   *
   * In THIS catalog rather than `mixer`'s, even though it names that tool:
   * the shell player is on every page in the app, and pulling the mixer's
   * whole catalog into it to read one line is the cost `player.ts` exists to
   * avoid. The take page reads it from here too, so there is one copy of the
   * words rather than two that can drift.
   *
   * Not just "Mixer": it sits beside other controls now, and a button next to
   * a button has to say what pressing it does — including that it LEAVES.
   */
  openInMixer: "Open in mixer",
};

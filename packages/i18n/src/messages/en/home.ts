// `/` — three sections, always in this order: what is new for you, what you
// are working on, and what the band recorded recently.

export const home = {
  /** The tab title, and the page's (visually hidden) h1. */
  title: "Home",

  // --- 1. what is new -------------------------------------------------------
  /**
   * The first section's heading: the takes waiting on the music stand. Only
   * drawn when something is new since the member's last visit.
   */
  onTheStand: "Up next",
  /** The eyebrow on its one card. */
  newSinceLastVisit: "New since your last visit",
  /**
   * The card's title for an event with no title or venue of its own: its kind
   * and its day. `kind` arrives capitalised ("Rehearsal").
   */
  unnamedEventTitle: ({ kind, date }: { kind: string; date: string }): string => `${kind}, ${date}`,
  /**
   * The line under the title: how many takes are new, and how many of them
   * this member has not voted on. `unvoted` 0 drops the second half.
   */
  newTakesLine: ({ takes, unvoted }: { takes: string; unvoted: number }): string =>
    unvoted > 0 ? `${takes}, ${unvoted} you haven't voted on yet` : takes,
  /** The vote button, with how many are waiting. Only drawn when that is above 0. */
  voteCount: (count: number): string => `Vote (${count})`,

  // --- 2. in progress -------------------------------------------------------
  /** The second section: the pinned plates and the stash card. */
  inProgress: "In progress",

  /** A take whose song has no title, and a pinned thing with no name. */
  untitled: "Untitled",

  /** What a pinned thing IS, when it is not an event (whose own kind is used). */
  takeWord: "Take",
  songWord: "Song",

  /**
   * A plate's accessible name — the caption is three separate elements
   * visually, so the link needs one sentence naming the thing.
   *
   * Three entries rather than one with a `kind` argument, because each reads
   * differently: a take is "from" a date, a song is followed by a count, and
   * an event is already named by its own label.
   */
  plateTakeName: ({ name, date }: { name: string; date: string }): string =>
    `${name} — take from ${date}`,
  plateSongName: ({ name, detail }: { name: string; detail: string }): string =>
    `${name} — song, ${detail}`,
  plateEventName: ({ name, detail }: { name: string; detail: string }): string =>
    `${name} — ${detail}`,

  /** The stash card's second line: when the latest recording was made, and how long it is. */
  stashLatestWhen: ({ date, length }: { date: string; length: string }): string =>
    `${date}, ${length}`,

  /** Nothing pinned and nothing in the stash. Split around the link the sentence contains. */
  emptyPinnedLead: "Nothing pinned yet.",
  emptyPinnedBody:
    "Tap the star on a song, take or event and it lands here — this is the shelf you reach for.",
  emptyPinnedLink: "Browse the archive",
  emptyPinnedTail: "to find something.",

  // --- 3. recent events -----------------------------------------------------
  recentEvents: "Recent events",
  emptyEvents:
    "No events yet. Ask whoever's running the session to log the next rehearsal or show — it'll show up here as soon as they do.",
};

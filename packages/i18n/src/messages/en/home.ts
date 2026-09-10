// `/` — the shelf: what this member pinned, then what the band recorded
// recently.

export const home = {
  title: "Home",

  /**
   * The page's h1. The shelf had no name at all before — the hero title named
   * the thing rather than the section, so the top of the page read as loose
   * stock rather than the start of a list.
   */
  favorites: "Favorites",

  /** The eyebrow over the hero: this is where you left off. */
  backTo: "Back to",

  /** A take whose song has no title, and a pinned thing with no name. */
  untitledTake: "Untitled take",
  untitled: "Untitled",

  /** What a pinned thing IS, when it is not an event (whose own kind is used). */
  takeWord: "Take",
  songWord: "Song",

  /**
   * The hero link is an overlay with no text inside it, so it has to name
   * itself out of the same parts the visible heading and meta line show.
   *
   * One function taking both halves rather than `${name} — ${kind}` assembled
   * at the call site: the dash is punctuation this language happens to use,
   * and another may want a different join or a different order.
   */
  heroName: ({ name, kind }: { name: string; kind: string }): string => `${name} — ${kind}`,

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

  /** Nothing pinned. Split around the link the sentence contains. */
  emptyPinnedLead: "Nothing pinned yet.",
  emptyPinnedBody:
    "Tap the star on a song, take or event and it lands here — this is the shelf you reach for.",
  emptyPinnedLink: "Browse the archive",
  emptyPinnedTail: "to find something.",

  recentEvents: "Recent events",
  emptyEvents:
    "No events yet. Ask whoever's running the session to log the next rehearsal or show — it'll show up here as soon as they do.",
};

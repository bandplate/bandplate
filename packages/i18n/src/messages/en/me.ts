// `/me` — the page about the member looking at it.
//
// Only the language picker lives here so far; the rest of the page is
// translated in its own commit.
import type { Locale } from "../../locale.js";

/**
 * What each language calls ITSELF.
 *
 * Autonyms, identical in every catalog, and that is the point rather than an
 * oversight: someone who set Czech by accident and cannot read a word of it
 * still has to be able to find their way back, and "English" written in
 * English is the only label that works for them. A translated list — "Angličtina
 * / Čeština" — is exactly the trap, because it is legible only to somebody who
 * already reads the language they are trying to leave.
 *
 * `messages/parity.test.ts` allowlists these for the same reason.
 */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  cs: "Čeština",
};

export const me = {
  title: "Me",
  votesHeading: "Your votes",
  allCaughtUp: "You've had your say on every published take.",
  /** A vote whose take has since been deleted. */
  untitledTake: "Untitled take",
  takeRemoved: "A take that's since been removed",
  /**
   * The unvoted count and its button.
   *
   * The number is rendered in its own element (it is set in the display face),
   * so the sentence takes the count only to agree with it, not to print it —
   * hence a function whose text starts after the number.
   */
  unvotedAfterCount: (count: number): string =>
    count === 1 ? "take is still waiting for your ear." : "takes are still waiting for your ear.",
  hearThem: (count: number): string => (count === 1 ? "Hear it" : "Hear them"),
  emptyVotes:
    "Nothing yet. Open a take and the keeper / not-a-keeper choice is right under the player.",
  /** The recorded verdict on a past vote — a record, not a control. */
  verdictKeeper: "keeper",
  verdictNotKeeper: "not a keeper",

  admin: "Admin",
  signOut: "Sign out",

  languageLegend: "Language",
  languageHint: "Applies everywhere, on every device you're signed in on.",
  /** The button that is already the current language, for screen readers. */
  languageCurrent: (name: string): string => `${name}, current language`,
  /** The one that isn't. */
  languageSwitch: (name: string): string => `Switch to ${name}`,
  languageSaved: "Language changed.",
  /**
   * Said on the picker, not discovered afterwards.
   *
   * Changing language forces a full page load, because the player, the vote
   * buttons and the confirm dialog are `transition:persist` — Astro MOVES
   * those islands between pages rather than remounting them, so their
   * already-rendered text cannot re-translate itself. A soft navigation would
   * leave half the furniture in the old language.
   */
  languageStopsPlayback: "Changing this reloads the page, so anything playing will stop.",
};

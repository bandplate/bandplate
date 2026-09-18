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
  votesHeading: "Recent votes",

  /** The hero's eyebrow — `members.createdAt`, which the row already carries. */
  memberSince: (date: string): string => `Member since ${date}`,
  /** A member an admin has not given instruments to yet. */
  noInstruments: "An admin assigns your instruments.",

  /**
   * The ledger. Four figures, and each label agrees with its own number —
   * "1 vote" / "12 votes" — so they are functions, not fixed words.
   */
  ledgerVotes: (count: number): string => (count === 1 ? "Vote" : "Votes"),
  ledgerKeepers: (count: number): string => (count === 1 ? "Keeper" : "Keepers"),
  ledgerAgreement: "With the band",
  ledgerWaiting: "Waiting on you",
  /** What agreement shows before anything has been settled. NOT 0%. */
  ledgerNoAnswer: "—",

  allVotes: (total: number): string => `All ${total} votes →`,
  switchLanguage: "Switch",
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

  /** `/me`'s install section. Shown only where installing is possible. */
  installHeading: "The app",
  installAction: "Install bandplate",
  /** iOS has no install button a page can offer, only these two taps. */
  installIosSteps: "Tap Share, then Add to Home Screen.",

  /**
   * `/me`'s theme picker. Three choices, not a light/dark switch: the app
   * follows the device until someone says otherwise, and a two-way switch
   * would take that away.
   */
  themeLegend: "Appearance",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "Automatic",
  /** Per browser, unlike the language, which follows the member everywhere. */
  themeHint: "Remembered in this browser only. Automatic follows your phone or computer.",

  languageLegend: "Language",
  languageHint: "Applies on every device.",
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
  languageStopsPlayback: "Switching reloads the page, so anything playing stops.",

  /**
   * `/me`'s Notifications section — between Language and the votes list.
   * Rendered only when `getWebConfig().push` exists (no VAPID keys, no
   * section: no fake affordance for a feature that isn't configured).
   */
  notifyHeading: "Notifications",
  /** The "off" state's button — subscribes this browser/device. */
  notifyTurnOn: "Turn on for this phone or computer",
  /** The "on" state's button — unsubscribes it again. */
  notifyTurnOff: "Turn off for this phone or computer",
  /** The server rejected the subscribe (the device cap, a 5xx, offline). */
  notifyTurnOnFailed: "Couldn't turn on notifications. Try again.",
  /** The server rejected the unsubscribe, or the request never reached it. */
  notifyTurnOffFailed: "Couldn't turn off notifications. Try again.",
  /** iOS grants the permission only to a page added to the home screen. */
  notifyIosNeedsInstall:
    "On iPhone, notifications only work from the app on your home screen. Add bandplate to your home screen, then turn them on there.",
  /** The member or the OS already blocked the permission. */
  notifyDenied:
    "Notifications are blocked for bandplate. Allow them in your browser or phone settings.",
  /** No service worker, no PushManager, or no Notification API. */
  notifyUnsupported: "This browser can't do notifications.",
  notifyNewTakes: "New takes from rehearsals",
  notifyWeeklyUnvoted: "Sunday vote reminder",
  notifySongChanges: "New songs and chord or lyric changes",
  notifySaved: "Saved.",
  notifySaveFailed: "Couldn't save. Try again.",
};

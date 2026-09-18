// `/me` — stránka o tom, kdo se na ni dívá.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ Every line carries the English it replaces as a trailing comment. Read  │
// │ the Czech, compare, and EDIT IT HERE — the edit is the fix.             │
// │                                                                        │
// │ Register is INFORMAL (tykání), matching the English.                    │
// │                                                                        │
// │ NOTE: the language NAMES are not in this file. They are autonyms —      │
// │ "English" and "Čeština", the same in every catalog — because somebody   │
// │ who set Czech by accident has to be able to find their way out of it.   │
// │ See `en/me.ts`.                                                        │
// └────────────────────────────────────────────────────────────────────────┘
import type { me as enMe } from "../en/me.js";

export const me = {
  title: "Já", // en: Me
  votesHeading: "Poslední hlasy", // en: Recent votes

  memberSince: (date: string): string => `Člen od ${date}`, // en: `Member since ${date}`
  noInstruments: "Nástroje ti přiřadí správce.", // en: An admin assigns your instruments.

  // en: "Vote" / "Votes" — the label agrees with its own number.
  // 1 hlas · 2–4 hlasy · 5+ hlasů.
  ledgerVotes: (count: number): string => (count === 1 ? "Hlas" : count < 5 ? "Hlasy" : "Hlasů"),
  // 1 držák · 2–4 držáky · 5+ držáků
  ledgerKeepers: (count: number): string =>
    count === 1 ? "Držák" : count < 5 ? "Držáky" : "Držáků",
  ledgerAgreement: "Shoda s kapelou", // en: With the band
  ledgerWaiting: "Čeká na tebe", // en: Waiting on you
  ledgerNoAnswer: "—", // en: —

  allVotes: (total: number): string => `Všech ${total} hlasů →`, // en: `All ${total} votes →`
  switchLanguage: "Přepnout", // en: Switch
  // en: You've had your say on every published take.
  allCaughtUp: "Ke všem zveřejněným nahrávkám ses vyjádřil.",
  untitledTake: "Nahrávka bez názvu", // en: Untitled take
  takeRemoved: "Nahrávka, která už byla smazaná", // en: A take that's since been removed
  // en: "take is still waiting for your ear." / "takes are …"
  //
  // The number sits in its own element, so this starts after it and only has
  // to agree: 1 nahrávka čeká · 2–4 nahrávky čekají · 5+ nahrávek čeká.
  unvotedAfterCount: (count: number): string =>
    count === 1
      ? "nahrávka čeká na tvoje ucho."
      : count < 5
        ? "nahrávky čekají na tvoje ucho."
        : "nahrávek čeká na tvoje ucho.",
  hearThem: (count: number): string => (count === 1 ? "Poslechnout" : "Poslechnout je"), // en: Hear it / Hear them
  // en: Nothing yet. Open a take and the keeper / not-a-keeper choice is right under the player.
  emptyVotes: "Zatím nic. Otevři nahrávku a volba držák / odpad je hned pod přehrávačem.",
  verdictKeeper: "držák", // en: keeper
  verdictNotKeeper: "odpad", // en: not a keeper

  admin: "Správa", // en: Admin
  signOut: "Odhlásit se", // en: Sign out

  installHeading: "V telefonu", // en: On your phone
  installAction: "Nainstalovat bandplate", // en: Install bandplate
  installIosSteps: "Klepni na Sdílet a pak na Přidat na plochu.", // en: Tap Share, then Add to Home Screen.

  languageLegend: "Jazyk", // en: Language
  languageHint: "Platí na všech zařízeních.", // en: Applies on every device.
  languageCurrent: (name: string): string => `${name}, současný jazyk`, // en: `${name}, current language`
  languageSwitch: (name: string): string => `Přepnout na ${name}`, // en: `Switch to ${name}`
  languageSaved: "Jazyk je změněný.", // en: Language changed.
  // en: Changing this reloads the page, so anything playing will stop.
  languageStopsPlayback: "Přepnutí zastaví přehrávání.",
} satisfies typeof enMe;

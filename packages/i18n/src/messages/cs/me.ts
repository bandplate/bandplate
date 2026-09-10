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
  languageLegend: "Jazyk", // en: Language
  languageHint: "Platí všude a na všech zařízeních, kde jsi přihlášený.", // en: Applies everywhere, on every device you're signed in on.
  languageCurrent: (name: string): string => `${name}, současný jazyk`, // en: `${name}, current language`
  languageSwitch: (name: string): string => `Přepnout na ${name}`, // en: `Switch to ${name}`
  languageSaved: "Jazyk je změněný.", // en: Language changed.
  // en: Changing this reloads the page, so anything playing will stop.
  languageStopsPlayback: "Přepnutí načte stránku znovu, takže se zastaví přehrávání.",
} satisfies typeof enMe;

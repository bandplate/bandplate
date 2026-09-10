// Slova o akcích — zkoušky, koncerty, studio.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání).                                     │
// │                                                                        │
// │ GLOSSARY IN USE HERE:                                                   │
// │   event → akce · rehearsal → zkouška · concert/live → naživo            │
// │   session → studio · take → take / taky / takeů                         │
// │                                                                        │
// │ WORTH CHECKING: `session` → "studio". The English word is ambiguous     │
// │ even in English (it also means an auth session), and what it actually   │
// │ describes is a studio date. If the band says "sešna", say so.           │
// └────────────────────────────────────────────────────────────────────────┘
import { plural } from "../../plural.js";
import type { events as enEvents } from "../en/events.js";

// en: { rehearsal: "rehearsal", concert: "live", session: "session" }
//
// Lowercase, because these render inside a badge and mid-sentence, never as
// the first word of one. A kind this map has not heard of passes through as
// whatever the admin typed — see the English file for why that is deliberate.
const KIND_WORDS: Record<string, string> = {
  rehearsal: "zkouška",
  concert: "naživo",
  session: "studio",
};

export const events = {
  kindLabel: (kind: string): string => KIND_WORDS[kind] ?? kind,

  unnamed: "Bez názvu", // en: Unnamed
  allEvents: "Všechny akce", // en: All events

  // en: `${count} ${count === 1 ? "take" : "takes"}`
  //
  // The loanword declined as Czech: 1 take · 2–4 taky · 5+ takeů. This is the
  // spelling already used in the UI showcase specimen ("Sedm takeů z jedné
  // zkoušky"), so it is the band's own usage rather than an invention.
  takeCount: (count: number): string =>
    `${count} ${plural("cs", count, { one: "take", few: "taky", many: "taku", other: "takeů" })}`,
} satisfies typeof enEvents;

// Rám, do kterého se kreslí každá stránka.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání), matching the English.               │
// │                                                                        │
// │ NAV LABELS ARE THE TIGHTEST COPY IN THE APP — they sit in a phone tab   │
// │ bar five across. Short wins over precise.                               │
// │                                                                        │
// │ GLOSSARY DECISIONS MADE HERE — all of them worth a second look:         │
// │   Takes → "Nahrávky"                                                    │
// │       The loanword "take" was the first draft and was overruled: its    │
// │       plural "taky" is identical to Czech *taky*, "also". "nahrávka" is │
// │       a regular feminine noun, declines cleanly, and is now used in     │
// │       body copy too — so the label and the prose finally agree.         │
// │   Events → "Akce"                                                       │
// │       "Události" reads like a calendar app. "Akce" is what a band says, │
// │       and it covers zkouška + koncert + studio alike.                   │
// │   Me → "Já"                                                             │
// │       Punchy and matches the app's plainness. "Moje" is the alternative.│
// └────────────────────────────────────────────────────────────────────────┘
import type { shell as enShell } from "../en/shell.js";

export const shell = {
  nav: {
    home: "Domů", // en: Home
    songs: "Skladby", // en: Songs
    events: "Akce", // en: Events
    takes: "Nahrávky", // en: Takes  — see the glossary note above
    me: "Já", // en: Me
    admin: "Správa", // en: Admin
  },

  adminNav: {
    overview: "Přehled", // en: Overview
    members: "Členové", // en: Members
    instruments: "Nástroje", // en: Instruments
    tokens: "Tokeny", // en: Tokens
  },

  adminSectionsLabel: "Sekce správy", // en: Admin sections
  navLabel: "Hlavní", // en: Main
  adminGroupLabel: "Správa", // en: Admin
  skipToContent: "Přeskočit na obsah", // en: Skip to content

  // en: Every rehearsal your band has recorded, in one place, with the keepers marked.
  shareDescription: "Všechny nahrané zkoušky na jednom místě, držáky označené.",

  // en: The bandplate wordmark beside a record, on a dark ground.
  shareImageAlt: "Logo bandplate vedle desky na tmavém pozadí.",
} satisfies typeof enShell;

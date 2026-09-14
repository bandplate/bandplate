// `/` — police: co sis připnul, a co kapela poslední dobou nahrála.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání) — this is the page the band opens    │
// │ one-handed while holding a nástroj, so short and warm beats correct.    │
// │                                                                        │
// │ GLOSSARY: favorites → oblíbené · take → NAHRÁVKA · song → skladba       │
// │                                                                        │
// │ WORTH CHECKING: `backTo` → "Zpátky k". It sits above a title in the     │
// │ nominative ("Zpátky k / Čoudy"), so it does not govern the case of what │
// │ follows — the heading is its own line, not the end of the phrase.       │
// └────────────────────────────────────────────────────────────────────────┘
import type { home as enHome } from "../en/home.js";

export const home = {
  title: "Domů", // en: Home

  favorites: "Oblíbené", // en: Favorites
  backTo: "Zpátky k", // en: Back to

  untitledTake: "Nahrávka bez názvu", // en: Untitled take
  untitled: "Bez názvu", // en: Untitled

  takeWord: "Nahrávka", // en: Take
  songWord: "Skladba", // en: Song

  // en: `${name} — ${kind}`
  heroName: ({ name, kind }: { name: string; kind: string }): string => `${name} — ${kind}`,

  // en: `${name} — take from ${date}`
  plateTakeName: ({ name, date }: { name: string; date: string }): string =>
    `${name} — nahrávka z ${date}`,
  // en: `${name} — song, ${detail}`
  plateSongName: ({ name, detail }: { name: string; detail: string }): string =>
    `${name} — skladba, ${detail}`,
  // en: `${name} — ${detail}`
  plateEventName: ({ name, detail }: { name: string; detail: string }): string =>
    `${name} — ${detail}`,

  emptyPinnedLead: "Zatím nic připnutého.", // en: Nothing pinned yet.
  // en: Tap the star on a song, take or event and it lands here — this is the shelf you reach for.
  emptyPinnedBody:
    "Klepni na hvězdičku u skladby, nahrávky nebo akce a objeví se to tady. Tohle je police, po které saháš.",
  emptyPinnedLink: "Projdi archiv", // en: Browse the archive
  emptyPinnedTail: "a něco si najdi.", // en: to find something.

  recentEvents: "Poslední akce", // en: Recent events
  // en: No events yet. Ask whoever's running the session to log the next rehearsal or show — it'll show up here as soon as they do.
  emptyEvents:
    "Zatím žádné akce. Řekni tomu, kdo nahrává, ať příští zkoušku nebo koncert založí. Objeví se to tu hned.",
} satisfies typeof enHome;

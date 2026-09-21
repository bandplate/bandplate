// `/` — tři sekce, vždycky v tomhle pořadí: co je pro tebe nové, na čem
// pracuješ, a co kapela poslední dobou nahrála.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání) — this is the page the band opens    │
// │ one-handed while holding a nástroj, so short and warm beats correct.    │
// │                                                                        │
// │ GLOSSARY: take → NAHRÁVKA · song → skladba · stash → šuplík             │
// │                                                                        │
// │ WORTH CHECKING: `onTheStand` → "Na pultu". Not a translation of "Up     │
// │ next": the notový pult is where the thing you are about to play sits,  │
// │ and that is the picture the section is named for.                      │
// │ `newTakesLine` → "u 2 ještě chybí tvůj hlas". Not "na 2 ještě nemáš    │
// │ hlas", which reads as "you have no vote". The subject is `hlas`, so    │
// │ the verb stays singular for every N: "u 1", "u 2", "u 5" all agree.    │
// └────────────────────────────────────────────────────────────────────────┘
import type { home as enHome } from "../en/home.js";

export const home = {
  title: "Domů", // en: Home

  onTheStand: "Na pultu", // en: Up next
  newSinceLastVisit: "Nové od tvé poslední návštěvy", // en: New since your last visit
  // en: `${kind}, ${date}`
  unnamedEventTitle: ({ kind, date }: { kind: string; date: string }): string => `${kind} ${date}`,
  // en: `${takes}, ${unvoted} you haven't voted on yet` (or just `${takes}` at 0)
  newTakesLine: ({ takes, unvoted }: { takes: string; unvoted: number }): string =>
    unvoted > 0 ? `${takes}, u ${unvoted} ještě chybí tvůj hlas` : takes,
  voteCount: (count: number): string => `Hlasovat (${count})`, // en: Vote ({count})

  inProgress: "Rozpracované", // en: In progress

  untitled: "Bez názvu", // en: Untitled

  takeWord: "Nahrávka", // en: Take
  songWord: "Skladba", // en: Song

  // en: `${name} — take from ${date}`
  plateTakeName: ({ name, date }: { name: string; date: string }): string =>
    `${name} — nahrávka z ${date}`,
  // en: `${name} — song, ${detail}`
  plateSongName: ({ name, detail }: { name: string; detail: string }): string =>
    `${name} — skladba, ${detail}`,
  // en: `${name} — ${detail}`
  plateEventName: ({ name, detail }: { name: string; detail: string }): string =>
    `${name} — ${detail}`,

  // en: `${date}, ${length}`
  stashLatestWhen: ({ date, length }: { date: string; length: string }): string =>
    `${date}, ${length}`,

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

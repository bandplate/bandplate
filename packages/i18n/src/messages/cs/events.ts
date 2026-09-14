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
  // "nahrávka", not the loanword "take" — the owner's call, and it settles a
  // problem the loanword could not: its plural "taky" is identical to Czech
  // *taky*, "also", which made it unusable as the nav label and ambiguous
  // mid-sentence. "nahrávka" is a regular feminine noun that declines
  // cleanly: 1 nahrávka · 2–4 nahrávky · 5+ nahrávek.
  //
  // It is FEMININE, which every sentence built around it has to agree with —
  // see `archiveConsequence` below.
  takeCount: (count: number): string =>
    `${count} ${plural("cs", count, { one: "nahrávka", few: "nahrávky", many: "nahrávky", other: "nahrávek" })}`,

  title: "Akce", // en: Events
  addEvent: "Přidat akci", // en: Add event
  addEventEyebrow: "Nová akce", // en: New event
  addEventTitle: "Přidat akci", // en: Add an event
  // en: A rehearsal, a concert, or a studio session — whatever the takes came from.
  addEventSubtitle: "Zkouška, koncert nebo studio, odkudkoli nahrávky přišly.",

  kindRehearsal: "Zkouška", // en: Rehearsal
  kindConcert: "Koncert", // en: Concert
  kindSession: "Studio", // en: Session
  filterRehearsals: "Zkoušky", // en: Rehearsals
  filterConcerts: "Koncerty", // en: Concerts
  filterSessions: "Studio", // en: Sessions

  dateLabel: "Datum", // en: Date
  venueLabel: "Místo", // en: Venue
  // en: Where you played. Leave it empty for the usual room.
  venueHint: "Kde jste hráli. Pro obvyklou zkušebnu nech prázdné.",
  titleLabel: "Název", // en: Title
  titleHint: "Jen pokud to mělo název. Většina zkoušek ho nemá.", // en: Only if it had a name — most rehearsals don't.
  notesLabel: "Poznámky", // en: Notes
  cancel: "Zrušit", // en: Cancel
  saveChanges: "Uložit změny", // en: Save changes

  // en: Nothing of that kind yet — turn another one back on.
  emptyFiltered: "Nic takového tu zatím není. Zapni zpátky jiný druh.",
  // en: No events yet — they'll show up here once a rehearsal or show is logged.
  empty: "Zatím žádné akce. Objeví se tu, jakmile někdo založí zkoušku nebo koncert.",

  archivedBanner: "Archivováno", // en: Archived
  // en: Archived. It's out of the archive; its takes are untouched.
  archivedDone: "Archivováno. Zmizela z archivu, nahrávky zůstávají.",
  created: "Přidáno. Nahrávky pořízené ten den patří sem.", // en: Added. Takes recorded that day go here.
  saved: "Uloženo.", // en: Saved.
  gone: "Tahle akce už tu není.", // en: That event is no longer here.
  takeGone: "Tohle už tu není. Načti stránku znovu.", // en: That's no longer here — reload and try again.
  takeDeleted: "Nahrávka smazaná i se soubory.", // en: Take deleted, along with its files.
  merged: "Sloučeno. Všechno je teď na téhle.", // en: Merged. Everything is on this one now.

  duplicateWarnTitle: "Ten den už jedna byla", // en: There was already one that day
  duplicateFiledTwiceTitle: "Tenhle den je založený dvakrát", // en: This day is filed twice
  mergeConfirmTitle: "Přesunout sem nahrávky z té druhé?", // en: Move the other one's takes here?
  // en: Its takes move across, keeping their songs, their files and their votes. The emptied event is archived rather than deleted, and this one takes over the key the bridge files against.
  mergeConfirmBody:
    "Její nahrávky se přesunou i se skladbami, soubory a hlasy. Vyprázdněná akce se archivuje, nemaže, a tahle převezme klíč, pod kterým to bridge zakládá.",
  mergeCta: "Sloučit", // en: Merge them
  openTheOther: "Otevřít tu druhou", // en: Open the other one
  moveTakesHere: "Přesunout její nahrávky sem", // en: Move its takes here

  // en: `Another ${kind} is filed on ${date}. That's fine if you really played twice — but if this is the same session, use the one that was already there, or the bridge will file its takes against it and leave this one empty.`
  //
  // The kind stays nominative — see `unarchiveConfirmTitle` for why nothing
  // here may assume it can inflect it.
  duplicateWarnBody: ({ kind, date }: { kind: string; date: string }): string =>
    `Na ${date} už je založená jiná akce (${kind}). To je v pořádku, jestli jste fakt hráli dvakrát, ale jestli je to ta samá, použij tu, co už tam byla, jinak k ní bridge založí nahrávky a tahle zůstane prázdná.`,
  // en: `Another ${kind} sits on ${date}. If you both played twice that's right — but if it's the same session, the takes are split between them and the bridge will keep filing against whichever one holds its key.`
  duplicateFiledTwiceBody: ({ kind, date }: { kind: string; date: string }): string =>
    `Na ${date} sedí ještě jiná akce (${kind}). Jestli jste hráli dvakrát, je to správně, ale jestli je to ta samá, nahrávky se mezi ně rozdělily a bridge bude dál zakládat k té, která drží jeho klíč.`,

  editEyebrow: "Úprava akce", // en: Editing event
  editSubtitle: "Povinné jsou jen datum a druh.", // en: Only the date and the kind are required.

  addTakeEyebrow: "Nová nahrávka", // en: New take
  addTakeTitle: "Přidat nahrávku", // en: Add a take
  addTakeSubtitle: "Patří k téhle akci; zvuk se přidá potom.", // en: It goes on this session; the audio comes afterwards.
  recordedLabel: "Nahráno", // en: Recorded
  takeLabelLabel: "Označení", // en: Label
  takeLabelHint: "Který pokus to byl: take 3, s dechy. Nepovinné.", // en: Which pass it was — take 3, with the horns. Optional.

  archiveThis: "Archivovat tuhle akci", // en: Archive this event
  putItBack: "Vrátit zpět", // en: Put it back
  whatWasIt: "Co to bylo", // en: What was it
  archived: "Archiv", // en: Archived
  edit: "Upravit", // en: Edit
  addTake: "Přidat nahrávku", // en: Add take
  instrumentsHeading: "Nástroje", // en: Instruments
  songHeading: "Skladba", // en: Song

  takesHeading: "Nahrávky", // en: Takes
  takesEmpty: "K téhle akci zatím žádné nahrávky.", // en: No takes logged for this one yet.
  // en: `${n} takes, in the order they were played`
  takesInOrder: (count: number): string =>
    `${count} ${plural("cs", count, { one: "nahrávka", few: "nahrávky", many: "nahrávky", other: "nahrávek" })} v pořadí, jak se hrály`,

  // en: `Put the ${kind} of ${date} back?`
  //
  // A COLON, not a genitive phrase. English can say "the rehearsal of 8 July";
  // Czech would need to inflect the kind, and `kindLabel` deliberately passes
  // unknown kinds through — an admin can add "jam", and nothing here could
  // decline a word it has never seen. After a colon the kind stays nominative
  // whatever it is. The date needs no help: the Czech long form ("8. července
  // 2026") is already genitive, so "z" governs it correctly.
  unarchiveConfirmTitle: ({ kind, date }: { kind: string; date: string }): string =>
    `Vrátit zpět: ${kind} z ${date}?`,
  unarchiveConfirmBody: "Vrátí se do archivu akcí a na úvodní stránku.", // en: It returns to the event archive and to home.
  unarchiveCta: "Vrátit z archivu", // en: Unarchive event
  // en: `Archive the ${kind} of ${date}?`
  archiveConfirmTitle: ({ kind, date }: { kind: string; date: string }): string =>
    `Archivovat: ${kind} z ${date}?`,
  archiveCta: "Archivovat akci", // en: Archive event
  // en: `the ${kind} of ${date}`
  // Nominative kind in brackets, same reason as the confirm titles above.
  archiveConfirmWhat: ({ kind, date }: { kind: string; date: string }): string =>
    `akci z ${date} (${kind})`,

  // en: head + (0 / 1 / n take clause) + "You can put it back any time."
  archiveConsequence: ({ takeCount }: { takeCount: number }): string => {
    const head = "Zmizí z archivu akcí i z úvodní stránky.";
    // The whole clause per category — the possessive, the verb and the rest
    // all agree with the count. See the sibling in `cs/songs.ts`.
    const takes =
      takeCount === 0
        ? ""
        : ` ${plural("cs", takeCount, {
            one: "Její jedna nahrávka zůstává a dál se dá přehrát, dostaneš se k ní přes její skladbu.",
            few: `Její ${takeCount} nahrávky zůstávají a dál se dají přehrát, dostaneš se k nim přes jejich skladby.`,
            many: `Jejích ${takeCount} nahrávky zůstává a dál se dají přehrát, dostaneš se k nim přes jejich skladby.`,
            other: `Jejích ${takeCount} nahrávek zůstává a dál se dají přehrát, dostaneš se k nim přes jejich skladby.`,
          })}`;
    return `${head}${takes} Kdykoli ji můžeš vrátit.`;
  },
} satisfies typeof enEvents;

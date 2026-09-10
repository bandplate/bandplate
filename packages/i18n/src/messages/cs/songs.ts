// `/songs` a `/songs/[slug]` — knihovna a stránka jedné skladby.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání).                                     │
// │                                                                        │
// │ GLOSSARY: song → skladba · take → take · key → tónina · tempo → tempo   │
// │           chords & lyrics → akordy a text · archive → archivovat        │
// │                                                                        │
// │ THE TWO CONSEQUENCE SENTENCES at the bottom are the ones to read most   │
// │ carefully. Each is shown in TWO places — the JS confirm dialog and the  │
// │ no-JS confirm page — and each is the last thing somebody reads before   │
// │ destroying work. They are restructured rather than translated word for  │
// │ word; see the comments on each.                                        │
// └────────────────────────────────────────────────────────────────────────┘
import { plural } from "../../plural.js";
import type { songs as enSongs } from "../en/songs.js";

export const songs = {
  title: "Skladby", // en: Songs
  addSong: "Přidat skladbu", // en: Add song
  addSongEyebrow: "Nová skladba", // en: New song
  addSongTitle: "Přidat skladbu", // en: Add a song
  // en: A title is all you need — the rest can wait until someone knows it.
  addSongSubtitle: "Stačí název — zbytek počká, až to bude někdo vědět.",

  titleLabel: "Název", // en: Title
  keyLabel: "Tónina", // en: Key
  keyHint: "Jak to říkáš ty — Am, F# dorská.", // en: However you say it — Am, F# dorian.
  tempoLabel: "Tempo", // en: Tempo
  tempoHint: "Údery za minutu.", // en: Beats per minute.
  notesLabel: "Poznámky", // en: Notes
  // en: Anything the band needs to remember about playing it.
  notesHint: "Cokoli, co si kapela potřebuje k hraní pamatovat.",
  cancel: "Zrušit", // en: Cancel

  searchLabel: "Hledat v názvech skladeb", // en: Search song titles
  searchPlaceholder: "Hledat názvy", // en: Search titles
  searchSubmit: "Hledat", // en: Search

  sortTitle: "Od A do Z", // en: A to Z
  sortRecent: "Naposled hrané", // en: Recently played
  sortTakes: "Nejvíc taků", // en: Most takes
  archived: "Archiv", // en: Archived

  // en: `${n} ${n === 1 ? "song" : "songs"}`
  //
  // The genitive plural after 5+ is what Czech takes after a bare numeral:
  // 1 skladba · 2–4 skladby · 5+ skladeb. Same axis as the plural category,
  // which is the whole reason a form record works here.
  countPlain: (count: number): string =>
    `${count} ${plural("cs", count, { one: "skladba", few: "skladby", many: "skladby", other: "skladeb" })}`,
  // en: `${n} ${n === 1 ? "song matches" : "songs match"}`
  // The verb agrees with the count too, so it lives inside the forms.
  countMatching: (count: number): string =>
    `${count} ${plural("cs", count, { one: "skladba odpovídá", few: "skladby odpovídají", many: "skladby odpovídá", other: "skladeb odpovídá" })}`,
  // en: `${n} archived ${n === 1 ? "song" : "songs"}`
  // The adjective agrees as well — "1 archivovaná skladba", "5 archivovaných
  // skladeb" — so the adjective and noun travel together.
  countArchived: (count: number): string =>
    `${count} ${plural("cs", count, { one: "archivovaná skladba", few: "archivované skladby", many: "archivované skladby", other: "archivovaných skladeb" })}`,

  // en: Archived. It's out of the library; its takes are untouched.
  archivedBannerDone: "Archivováno. Zmizela z knihovny, taky zůstávají.",
  unarchivedDone: "Zpátky v knihovně.", // en: Back in the library.
  // en: Song deleted, along with its takes and their files.
  deletedDone: "Skladba smazána i s taky a jejich soubory.",

  emptySearch: "Tomu hledání neodpovídá žádná skladba.", // en: No songs match that search.
  emptyArchive: "V archivu nic není.", // en: Nothing archived.
  // en: No songs yet. Add one, or wait for the first takes to come in.
  empty: "Zatím žádné skladby. Přidej nějakou, nebo počkej na první taky.",

  noKeyOrTempo: "Bez tóniny a tempa", // en: No key or tempo
  bpm: (tempo: number): string => `${tempo} bpm`, // en: `${tempo} bpm`

  archivedBanner: "Archivováno", // en: Archived
  unarchiveConfirmTitle: (title: string): string => `Vrátit ${title} zpět?`, // en: `Put ${title} back?`
  // en: It returns to the song library and to the picker when you add a take.
  unarchiveConfirmBody: "Vrátí se do knihovny i do výběru, když přidáváš take.",
  unarchiveCta: "Vrátit z archivu", // en: Unarchive song

  created: "Přidáno. Zbytek doplň, až budeš chtít.", // en: Added. Fill in the rest whenever you like.
  saved: "Uloženo.", // en: Saved.
  gone: "Tahle skladba už tu není.", // en: That song is no longer here.
  takeGone: "Tohle už tu není — načti stránku znovu.", // en: That's no longer here — reload and try again.

  editEyebrow: "Úprava skladby", // en: Editing song
  editSubtitle: "Kromě názvu je všechno nepovinné.", // en: Everything here is optional except the title.
  // en: The web address stays as it is — renaming won't break links anyone has.
  slugHint: "Adresa zůstane stejná — přejmenování nerozbije odkazy, které kdo má.",

  addTakeEyebrow: "Nový take", // en: New take
  addTakeTitle: "Přidat take", // en: Add a take
  addTakeSubtitle: "Patří k téhle skladbě; zvuk se přidá potom.", // en: It goes on this song; the audio comes afterwards.
  addTake: "Přidat take", // en: Add take
  recordedLabel: "Nahráno", // en: Recorded
  takeLabelLabel: "Označení", // en: Label
  takeLabelHint: "Který pokus to byl — take 3, s dechy. Nepovinné.", // en: Which pass it was — take 3, with the horns. Optional.

  chartHeading: "Akordy a text", // en: Chords & lyrics
  chordsHeading: "Akordy", // en: Chords
  lyricsHeading: "Text", // en: Lyrics
  chartEmpty: "Zatím to nikdo nesepsal.", // en: Nobody's written these down yet.

  generalNotesHeading: "Obecné poznámky", // en: General notes
  aliasesHeading: "Známé taky jako", // en: Also known as

  takesHeading: "Taky", // en: Takes
  // en: No takes of this one yet — record a rehearsal and it'll show up here.
  takesEmpty: "Zatím žádný take — nahrajte zkoušku a objeví se tady.",
  showMore: (count: number): string => `Zobrazit dalších ${count}`, // en: `Show ${count} more`
  showFewer: "Zobrazit méně", // en: Show fewer

  archiveConfirmTitle: (title: string): string => `Archivovat ${title}?`, // en: `Archive ${title}?`
  archiveCta: "Archivovat skladbu", // en: Archive song
  // en: `Delete ${title} and everything under it?`
  deleteConfirmTitle: (title: string): string => `Smazat ${title} a všechno pod tím?`,
  deleteCta: "Smazat skladbu", // en: Delete song

  // en: head + (0 / 1 / n take clause) + reassurance tail
  //
  // Same three-part shape as the English, because the structure is the point:
  // a song with no takes must say NOTHING about takes ("Její 0 taků zůstává"
  // reads like a bug). The counts decline — 1 take · 2–4 taky · 5+ takeů —
  // and the verb agrees with them, so both live in the form record.
  archiveConsequence: ({ takeCount }: { takeCount: number }): string => {
    const head = "Zmizí z knihovny skladeb i z výběru, když přidáváš take.";
    const takes =
      takeCount === 0
        ? ""
        : takeCount === 1
          ? " Její jeden take zůstává, dál se dá přehrát a pořád se najde ve vyhledávání."
          : ` Jejích ${takeCount} ${plural("cs", takeCount, { one: "take", few: "taky", many: "taku", other: "takeů" })} zůstává, dál se dají přehrát a pořád se najdou ve vyhledávání.`;
    const tail = " Když ji bridge nahraje znovu, vrátí se sama, a kdykoli ji můžeš vrátit ručně.";
    return `${head}${takes}${tail}`;
  },

  // en: leads with the recordings, not the song
  //
  // The lead is kept: "Tohle nejde vzít zpět" first, then what is destroyed,
  // then the alternative. That order is the whole design of the sentence —
  // somebody skimming a confirm dialog reads the first clause and the last.
  deleteConsequence: ({
    takeCount,
    fileCount,
    byteTotal,
  }: {
    takeCount: number;
    fileCount: number;
    byteTotal: string;
  }): string => {
    if (takeCount === 0) {
      return "Tohle nejde vzít zpět. Nemá žádné taky, takže se neztratí nic nahraného — zmizí jen skladba, její aliasy a poznámky.";
    }
    const takes = `${takeCount} ${plural("cs", takeCount, { one: "take", few: "taky", many: "taku", other: "takeů" })}`;
    const files =
      fileCount === 0
        ? ""
        : ` a ${fileCount} ${plural("cs", fileCount, { one: "zvukový soubor", few: "zvukové soubory", many: "zvukového souboru", other: "zvukových souborů" })} (${byteTotal})`;
    return `Tohle nejde vzít zpět. Natrvalo smaže ${takes}${files}, všechny hlasy o nich i všechna připnutí. Jestli ji chceš jen dostat z knihovny, radši ji archivuj — tím se nahrávky zachovají.`;
  },

  errTitleRequired: "Zadej název.", // en: Enter a title.
  errTempoPositive: "Tempo musí být kladné číslo.", // en: Tempo has to be a positive number.
  // en: That tempo looks wrong — 400 bpm is the ceiling.
  errTempoCeiling: "Tohle tempo nevypadá dobře — strop je 400 bpm.",
} satisfies typeof enSongs;

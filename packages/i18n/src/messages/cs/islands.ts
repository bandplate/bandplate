// Editor akordů, nahrávání souborů a potvrzovací dialog.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání).                                     │
// │                                                                        │
// │ GLOSSARY: section → sloka (the parser already knows Sloka/Refrén —      │
// │           see `server/song-text.ts`, which has been bilingual from the  │
// │           start) · stem → stopa · master → master · file → soubor       │
// │                                                                        │
// │ `chartSectionNamePlaceholder` is "Sloka" ON PURPOSE: it has to be a     │
// │ word `KNOWN_SECTION_WORDS` recognises, or the editor will warn about    │
// │ its own placeholder. Do not change it without checking that list.       │
// └────────────────────────────────────────────────────────────────────────┘
import type { islands as enIslands } from "../en/islands.js";

export const islands = {
  chartAddSection: "Přidat část", // en: Add a section
  chartRemove: "Odebrat", // en: Remove
  chartSectionNamePlaceholder: "Sloka", // en: Verse  — must stay a known section word
  chartChordsPlaceholder: "Am Dm7", // en: Am Dm7
  chartLyricsPlaceholder: "Text téhle části", // en: The words for this section
  chartChordsHeading: "Akordy", // en: Chords
  chartLyricsHeading: "Text", // en: Lyrics
  chartFormatHint: "Jedna část na řádek:", // en: One section per line:
  chartFormatExample: "Sloka: Am Dm7", // en: Verse: Am Dm7

  chartUnnamedSection: (index: number): string => `část ${index}`, // en: `section ${index}`
  chartSectionNameLabel: (index: number): string => `Název části ${index}`, // en: `Section ${index} name`
  chartMoveUp: (name: string): string => `Posunout ${name} nahoru`, // en: `Move ${name} up`
  chartMoveDown: (name: string): string => `Posunout ${name} dolů`, // en: `Move ${name} down`
  chartRemoveRow: (name: string): string => `Odebrat ${name}`, // en: `Remove ${name}`
  chartChordsFor: (name: string): string => `Akordy pro ${name}`, // en: `Chords for ${name}`
  chartWordsFor: (name: string): string => `Text pro ${name}`, // en: `Words for ${name}`

  // en: "One section has…" / "${n} sections have…"
  //
  // Czech puts the count first in every branch and agrees the noun and the
  // verb with it: 1 část má · 2–4 části mají · 5+ částí má.
  chartUnknownNames: (count: number): string =>
    count === 1
      ? "Jedna část má název, který stránka skladby nepozná"
      : count < 5
        ? `${count} části mají název, který stránka skladby nepozná`
        : `${count} částí má název, který stránka skladby nepozná`,

  uploadAddFiles: "Přidat soubory", // en: Add files
  uploadFilesHeading: "Soubory", // en: Files
  uploadFilesAdded: "Soubory přidány.", // en: Files added.
  // en: `Adding ${n} ${n === 1 ? "file" : "files"}.`
  uploadAdding: (count: number): string =>
    `Přidávám ${count} ${count === 1 ? "soubor" : count < 5 ? "soubory" : "souborů"}.`,
  uploadRemove: "Odebrat", // en: Remove
  uploadReplace: "Nahradit", // en: Replace it
  uploadSkip: "Přeskočit", // en: Skip
  uploadRetry: "Zkusit znovu", // en: Try again
  uploadWhichInstrument: "Který nástroj?", // en: Which instrument?
  uploadInstrumentFor: (fileName: string): string => `Nástroj pro ${fileName}`, // en: `Instrument for ${fileName}`
  uploadMaster: "Master", // en: Master
  uploadStem: "Stopa", // en: Stem

  uploadPhaseReading: "Čtu ho", // en: Reading it
  uploadPhaseStarting: "Začínám", // en: Starting
  uploadPhaseChecking: "Ověřuju, že dorazil", // en: Checking it arrived
  uploadPhaseDone: "Hotovo", // en: Done
  uploadPhaseAlreadyThere: "Už tam je", // en: Already there
  uploadPhaseUnfinished: "Nedokončeno", // en: Didn't finish
  uploadPhaseWaitingOnYou: "Čeká na tebe", // en: Waiting on you
  uploadPhaseWaiting: "Čeká", // en: Waiting

  // en: Not audio this app stores — mp3, opus, flac or wav.
  uploadErrNotAudio: "Tohle není zvuk, který aplikace ukládá — mp3, opus, flac nebo wav.",
  uploadErrGone: "Tenhle soubor už není k dispozici.", // en: That file is no longer available.
  uploadErrConnection: "Spadlo spojení.", // en: The connection dropped.
  uploadErrStopped: "Nahrávání bylo zastaveno.", // en: The upload was stopped.
  uploadErrRefused: (status: number): string => `Soubor byl odmítnut (${status}).`, // en: `The file was refused (${status}).`
  uploadErrRejected: "Server ten soubor nepřijal.", // en: The server wouldn't take that file.
  // en: The upload didn't finish. Nothing was saved — it starts again from the beginning.
  uploadErrUnfinished: "Nahrávání se nedokončilo. Nic se neuložilo — začíná se znovu od začátku.",
  uploadErrGeneric: "Něco se pokazilo.", // en: Something went wrong.

  confirmTitle: "Určitě?", // en: Are you sure?
  confirmBody: "Tohle nejde vzít zpět.", // en: This can't be undone.
  confirmCta: "Potvrdit", // en: Confirm
  confirmCancel: "Zrušit", // en: Cancel
  confirmWorking: "Pracuju…", // en: Working…
  confirmFailed: "Nepovedlo se. Zkus to znovu.", // en: That didn't work. Try again.
  // en: `That didn't work (status ${status}). Try again.`
  confirmFailedStatus: (status: number): string => `Nepovedlo se (stav ${status}). Zkus to znovu.`,

  copy: "Kopírovat", // en: Copy
  copied: "Zkopírováno", // en: Copied
  copyFailed: "Nepodařilo se zkopírovat", // en: Couldn't copy
} satisfies typeof enIslands;

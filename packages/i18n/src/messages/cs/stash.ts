// Šuplík: soukromé nahrávky člena, nahrávátko a list „Přidat k písni“.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Register is INFORMAL        │
// │ (tykání). stash → šuplík · take/recording → nahrávka · song → píseň     │
// │ WORTH CHECKING: "Kdo nahrál" is the owner's settled label. A question,  │
// │ not "Nahrál", so the label does not guess the member's gender.         │
// └────────────────────────────────────────────────────────────────────────┘
import type { stash as enStash } from "../en/stash.js";

export const stash = {
  pill: "Šuplík", // en: Stash
  viewLede: "Nahrávky, které vidíš jen ty.", // en: Recordings only you can see.
  recordIdea: "Nahrát nápad", // en: Record an idea
  empty: "Šuplík je prázdný. Nahraj nápad a objeví se tady.", // en: Your stash is empty. Record an idea and it lands here.
  unknownSong: "Neznámá píseň", // en: Unknown song
  noSongYet: "Zatím bez písně", // en: No song yet
  chipWaiting: "Čeká na signál", // en: Waiting for signal
  chipSyncing: "Nahrává se", // en: Uploading
  chipFailed: "Nejde nahrát", // en: Couldn't upload
  retry: "Zkusit znovu", // en: Try again
  discardPendingBody: "Je jen v tomhle zařízení, takže ji zahodíš natrvalo.", // en: It is only on this device, so throwing it away loses it for good.
  open: "Otevřít", // en: Open
  inYourStash: (count: number): string => `Ve tvém šuplíku: ${count}`, // en: In your stash: N
  homeLine: (count: number): string => `V šuplíku ${count}`, // en: N in your stash

  close: "Zavřít", // en: Close
  stepOne: "Krok 1 ze 2", // en: Step 1 of 2
  stepTwo: "Krok 2 ze 2", // en: Step 2 of 2
  pickTitle: "Ke které písni?", // en: Which song?
  searchLabel: "Najdi píseň", // en: Find a song
  recentSongs: "Naposledy", // en: Recent
  allSongs: "Všechny písně", // en: All songs
  noSongMatch: "Žádná píseň tomu neodpovídá.", // en: No song matches that.
  noSongs: "V knihovně zatím nejsou žádné písně. Nejdřív nějakou přidej.", // en: The library has no songs yet. Add one first.
  noSongsRecordAnyway:
    "V knihovně zatím nejsou žádné písně. Nápad si nahraj i tak a přiřadíš ho, až nějaká bude.", // en: The library has no songs yet. Record the idea anyway …
  recordFor: (title: string): string => `Nahrávat k ${title}`, // en: Record for {title}
  recordWithoutSong: "Nahrávat bez písně", // en: Record without a song
  recordingInto: "Nahrávám do šuplíku", // en: Recording into your stash
  screenNote: "Displej může zhasnout, nahrávání běží dál.", // en: The screen may go dark; recording keeps going.
  levelHint: "Kroužek ukazuje hlasitost. Když svítí celý, jsi moc blízko.", // en: The ring shows your level. If it's full all the way round, you're too close.
  start: "Začít nahrávat", // en: Start recording
  stop: "Zastavit nahrávání", // en: Stop recording
  cancel: "Zrušit", // en: Cancel
  timerLabel: "Délka nahrávky", // en: Recording length
  discardQuestion: "Zahodit nahrávku?", // en: Throw this recording away?
  discard: "Zahodit", // en: Throw away
  keepRecording: "Nahrávat dál", // en: Keep recording
  finishing: "Dokončuju nahrávku", // en: Finishing the recording
  reviewPlay: "Přehrát", // en: Play
  reviewPause: "Pozastavit", // en: Pause
  reviewSeek: "Skočit na místo v nahrávce", // en: Jump to a point in the recording
  labelField: "Popisek (nepovinný)", // en: Label (optional)
  labelPlaceholder: "třeba nápad na mezihru", // en: e.g. an idea for the bridge
  redo: "Znovu", // en: Again
  save: "Uložit do šuplíku", // en: Save to stash
  privateNote: "Uvidíš ji jen ty. K písni ji můžeš přidat později ze šuplíku.", // en: Only you will see it. …
  errDenied:
    "Prohlížeč nepustil aplikaci k mikrofonu. Povol ho v nastavení stránky a zkus to znovu.", // en: The browser won't let the app use the microphone. …
  errNoMic: "Tohle zařízení nemá mikrofon.", // en: This device has no microphone.
  errUnsupported: "Tenhle prohlížeč neumí nahrávat zvuk.", // en: This browser can't record audio.
  errSaveFailed: "Nahrávku se nepodařilo uložit do zařízení. Zkus to znovu.", // en: Couldn't keep the recording on this device. Try again.

  pageTitle: (title: string): string => `${title} v šuplíku`, // en: {title} in your stash
  songAndLength: (title: string, length: string): string => `${title}, ${length}`, // en: {title}, {m:ss}
  backToStash: "Zpět do šuplíku", // en: Back to the stash
  addTitle: "Přidat k písni", // en: Add to song
  fieldSong: "Píseň", // en: Song
  fieldEvent: "Akce", // en: Event
  fieldBy: "Kdo nahrál", // en: Recorded by
  personalEvent: (date: string): string => `Osobní nahrávky, ${date}`, // en: Personal recordings, {date}
  publishNote: "Uvidí ji celá kapela u písně. Nehlasuje se o ní a nikomu nepřijde upozornění.", // en: The whole band will see it …
  publish: "Přidat k písni", // en: Add to song
  chooseSong: "Ke které písni to patří?", // en: Which song is this?
  chooseSongPlaceholder: "Vyber píseň", // en: Pick a song
  noSongChosen: "Nejdřív vyber píseň, pak ji přidej.", // en: Pick a song first, then add it.
  songGone: "Tahle píseň už v knihovně není.", // en: That song is not in the library any more.
  stillUploading: "Nahrávka je ještě na cestě z telefonu, který ji nahrál.", // en: This recording is still on its way …
  rename: "Přejmenovat", // en: Rename
  renameSave: "Uložit", // en: Save
  renamed: "Přejmenováno.", // en: Renamed.
  labelTooLong: "Popisek je moc dlouhý. Vejde se 200 znaků.", // en: That label is too long. 200 characters fit.
  download: "Stáhnout", // en: Download
  delete: "Smazat", // en: Delete
  deleteTitle: (title: string): string => `Smazat nahrávku: ${title}?`, // en: Delete this recording of {title}?
  deleteBody: "Zmizí natrvalo i se souborem. Nikdo jiný ji neviděl.", // en: It's gone for good, file included. …
  deleteCta: "Smazat nahrávku", // en: Delete recording
} satisfies typeof enStash;

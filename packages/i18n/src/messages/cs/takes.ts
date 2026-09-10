// `/takes` (archiv a filtry) a `/takes/[id]` (jedna nahrávka).
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání).                                     │
// │                                                                        │
// │ GLOSSARY: take → nahrávka (f.) · master → master · stem → stopa         │
// │           keeper → držák · vote → hlas · asset/file → soubor            │
// │                                                                        │
// │ WORTH CHECKING:                                                         │
// │   `masterLabel` stays "Master" — it is what the file IS in every studio │
// │   in the country, and the player says it beside "stopa" for the stems.  │
// │   `keeperCta` uses the settled "držák".                                 │
// └────────────────────────────────────────────────────────────────────────┘
import { plural } from "../../plural.js";
import type { takes as enTakes } from "../en/takes.js";

const TAKE_FORMS = {
  one: "nahrávka",
  few: "nahrávky",
  many: "nahrávky",
  other: "nahrávek",
};

export const takes = {
  title: "Nahrávky", // en: Takes
  // en: `${n} ${n === 1 ? "take" : "takes"}`
  count: (total: number): string => `${total} ${plural("cs", total, TAKE_FORMS)}`,
  filtered: "filtrováno", // en: filtered

  filters: "Filtry", // en: Filters
  filtersClose: "Zavřít filtry", // en: Close filters
  clear: "Zrušit filtry", // en: Clear
  showTakes: "Zobrazit nahrávky", // en: Show takes

  songLabel: "Skladba", // en: Song
  anySong: "Libovolná skladba", // en: Any song
  instrumentsLegend: "Nástroje", // en: Instruments
  instrumentsAll: "— všechny naráz", // en: — all of these

  recordedLegend: "Nahráno", // en: Recorded
  anyTime: "Kdykoli", // en: Any time
  pastWeek: "Poslední týden", // en: Past week
  pastMonth: "Poslední měsíc", // en: Past month
  past3Months: "Poslední 3 měsíce", // en: Past 3 months
  pastYear: "Poslední rok", // en: Past year
  exactDates: "Přesná data", // en: Exact dates
  recordedFrom: "Nahráno od", // en: Recorded from
  recordedTo: "Nahráno do", // en: Recorded to
  // en: A date here is used instead of the choice above.
  exactDatesNote: "Datum tady má přednost před výběrem nahoře.",

  yoursLegend: "Tvoje", // en: Yours
  notVotedByMe: "Ještě jsem nehlasoval", // en: Not voted by me

  sortLabel: "Řadit podle", // en: Sort by
  sortRecent: "Nejnovější", // en: Most recent
  sortRating: "Nejvíc hlasů pro držák", // en: Most keeper votes

  // en: No takes match those filters — try turning one off.
  emptyFiltered: "Těmhle filtrům neodpovídá žádná nahrávka — zkus některý vypnout.",
  empty: "V archivu zatím nic není.", // en: No takes in the archive yet.

  pageTitle: (songTitle: string): string => `Nahrávka: ${songTitle}`, // en: `Take of ${songTitle}`
  pageTitleUnknown: "Nahrávka", // en: Take

  saved: "Uloženo.", // en: Saved.
  fileDeleted: "Soubor smazán.", // en: File deleted.
  gone: "Tahle nahrávka už tu není.", // en: That take is no longer here.
  // en: That song is no longer here — reload and pick another.
  songGone: "Tahle skladba už tu není — načti stránku a vyber jinou.",

  nothingToPlayTitle: "Není co přehrát", // en: Nothing left to play
  // en: This take is published but has no playable file. Add one, or unpublish it.
  nothingToPlayBody:
    "Nahrávka je zveřejněná, ale nemá žádný přehratelný soubor. Přidej ho, nebo ji stáhni ze zveřejnění.",
  published: "Zveřejněno. Kapela to teď najde.", // en: Published. The band can find it now.
  // en: Unpublished. Only someone with the link will find it.
  unpublished: "Staženo. Najde to jen ten, kdo má odkaz.",
  // en: There's nothing on this take that can be played yet, so there's nothing to publish.
  publishBlocked: "Na téhle nahrávce zatím není nic přehratelného, takže není co zveřejnit.",

  draftEyebrow: "Zatím nezveřejněno", // en: Not published yet
  draftReady: "Dokud to nezveřejníš, nikdo to nenajde.", // en: Nobody will find this take until you publish it.
  // en: Put something on it that can be played, and you'll be able to publish it.
  draftNotReady: "Přidej něco, co se dá přehrát, a půjde to zveřejnit.",
  publishTake: "Zveřejnit nahrávku", // en: Publish take
  unpublishThisTake: "Stáhnout ze zveřejnění", // en: Unpublish this take

  listenHeading: "Poslech", // en: Listen
  yourVoteHeading: "Tvůj hlas", // en: Your vote
  instrumentsHeading: "Nástroje", // en: Instruments
  adminHeading: "Správa", // en: Admin
  songHeading: "Skladba", // en: Song

  playThisTake: "Přehrát tuhle nahrávku", // en: Play this take
  soloAnInstrument: "Sólo jednoho nástroje", // en: Solo an instrument
  fullMix: "Celý mix", // en: Full mix
  unknownInstrument: "Neznámý nástroj", // en: Unknown instrument
  masterLabel: "Master", // en: Master
  losslessMaster: "bezztrátový master", // en: lossless master
  masterMix: "master mix", // en: master mix

  editEyebrow: "Úprava nahrávky", // en: Editing take
  edit: "Upravit", // en: Edit
  recordedLabel: "Nahráno", // en: Recorded
  takeLabelLabel: "Označení", // en: Label
  // en: Which pass it was — take 3, with the horns. Leave it empty if there's nothing to say.
  takeLabelHint: "Který pokus to byl — třetí, s dechy. Nech prázdné, když není co dodat.",
  notesLabel: "Poznámky", // en: Notes
  saveChanges: "Uložit změny", // en: Save changes
  cancel: "Zrušit", // en: Cancel

  // en: Take added. Nobody will find it until there's something to play and you publish it.
  takeAdded: "Nahrávka přidaná. Nikdo ji nenajde, dokud na ní nebude co pustit a nezveřejníš ji.",
  thisTake: "tuhle nahrávku", // en: this take
  // en: Votes only inform this — promoting or rejecting is a deliberate call, not automatic.
  votesInform: "Hlasy jsou jen vodítko — označit za držák nebo odmítnout je vědomé rozhodnutí.",
  losslessYes: "Bezztrátový master je k dispozici.", // en: A lossless master is available.
  losslessNo: "Bezztrátový master zatím není.", // en: No lossless master available yet.

  noAssets: "K téhle nahrávce zatím nejsou žádné soubory.", // en: No assets uploaded for this take yet.
  deleteFile: "Smazat soubor", // en: Delete file
  // en: `Download ${label} (${format}, ${size})`
  downloadAsset: ({
    label,
    format,
    size,
  }: { label: string; format: string; size: string }): string =>
    `Stáhnout ${label} (${format}, ${size})`,
  deleteAsset: (label: string): string => `Smazat ${label}`, // en: `Delete ${label}`
  // en: `Delete the ${label} from this take?`
  deleteAssetConfirmTitle: (label: string): string => `Smazat ${label} z téhle nahrávky?`,
  deleteTake: "Smazat nahrávku", // en: Delete take
  deleteThisTake: "Smazat tuhle nahrávku", // en: Delete this take

  keeperCta: "Označit jako držák", // en: Promote to keeper
  // en: This take will be marked keeper — the band's pick for this song at this event.
  keeperBody: "Nahrávka se označí jako držák — volba kapely pro tuhle skladbu z téhle akce.",
  rejectCta: "Odmítnout", // en: Reject
  // en: This take will be marked rejected and dropped from 'needs your vote'. It stays in the archive.
  rejectBody: "Nahrávka se označí jako odmítnutá a zmizí z „čeká na tvůj hlas“. V archivu zůstává.",

  // en: "This can't be undone." + files clause + votes clause + "The song and the event stay."
  //
  // Both counts agree with their nouns AND their verbs, so each clause is
  // built from a form record rather than a noun dropped into a frame:
  //   1 hlas o ní padl · 2–4 hlasy o ní padly · 5+ hlasů o ní padlo
  deleteConsequence: ({
    fileCount,
    byteTotal,
    totalVotes,
  }: {
    fileCount: number;
    byteTotal: string;
    totalVotes: number;
  }): string => {
    const files =
      fileCount === 0
        ? "Zatím nemá žádné soubory."
        : `Natrvalo smaže ${fileCount} ${plural("cs", fileCount, { one: "soubor", few: "soubory", many: "souboru", other: "souborů" })} (${byteTotal}).`;
    const votes =
      totalVotes === 0
        ? ""
        : ` ${plural("cs", totalVotes, {
            one: `Zmizí i ${totalVotes} hlas, který o ní padl.`,
            few: `Zmizí i ${totalVotes} hlasy, které o ní padly.`,
            many: `Zmizí i ${totalVotes} hlasu, které o ní padly.`,
            other: `Zmizí i ${totalVotes} hlasů, které o ní padly.`,
          })}`;
    return `Tohle nejde vzít zpět. ${files}${votes} Skladba a akce zůstávají.`;
  },

  // en: head + (last-playable clause | "The take keeps its other files.")
  deleteAssetConsequence: ({
    label,
    format,
    tier,
    bytes,
    isLastPlayable,
  }: {
    label: string;
    format: string;
    tier: string;
    bytes: string;
    isLastPlayable: boolean;
  }): string => {
    const head = `Tohle nejde vzít zpět. Odstraní z úložiště ${label} (${format}, ${tier}, ${bytes}).`;
    return isLastPlayable
      ? `${head} Je to jediné, z čeho se tahle nahrávka dá přehrát, takže pak nebude co pouštět.`
      : `${head} Ostatní soubory nahrávce zůstanou.`;
  },
} satisfies typeof enTakes;

// Pár věcí, které nepatří žádné konkrétní stránce.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání), matching the English.               │
// └────────────────────────────────────────────────────────────────────────┘
import { formatNumber, plural } from "../../plural.js";
import type { common as enCommon, ListNoun } from "../en/common.js";

// Every form a list footer needs of each noun. Czech declines the noun after
// a numeral AND after "z", so one record per noun names each case outright
// rather than guessing it from a stem:
//   sg / accSg / genSg   1 nahrávka · další nahrávku · z 1 nahrávky
//   pl / genPl           3 nahrávky · 25 nahrávek
// `masc` picks the participle for 1–4 ("Zobrazen 1 hlas", "Zobrazena 1 akce").
const NOUNS: Record<
  ListNoun,
  { sg: string; accSg: string; genSg: string; pl: string; genPl: string; masc: boolean }
> = {
  take: {
    sg: "nahrávka",
    accSg: "nahrávku",
    genSg: "nahrávky",
    pl: "nahrávky",
    genPl: "nahrávek",
    masc: false,
  },
  song: {
    sg: "skladba",
    accSg: "skladbu",
    genSg: "skladby",
    pl: "skladby",
    genPl: "skladeb",
    masc: false,
  },
  event: { sg: "akce", accSg: "akci", genSg: "akce", pl: "akce", genPl: "akcí", masc: false },
  vote: { sg: "hlas", accSg: "hlas", genSg: "hlasu", pl: "hlasy", genPl: "hlasů", masc: true },
};

const n = (value: number): string => formatNumber("cs", value);

/** The noun after "z 225": genitive, singular only for 1 and decimals. */
const ofTotal = (kind: ListNoun, total: number): string => {
  const f = NOUNS[kind];
  return plural("cs", total, { one: f.genSg, many: f.genSg, other: f.genPl });
};

export const common = {
  // en: Something about that request looked wrong. Reload the page and try again.
  originError: "Na tom požadavku bylo něco špatně. Načti stránku znovu a zkus to zas.",

  genericError: "Nepovedlo se. Zkus to znovu.", // en: That didn't work. Try again.

  closeWithoutSaving: "Zavřít bez uložení", // en: Close without saving

  instrumentsVerb: "Nástroje", // en: Instruments
  playsVerb: "Hraje na", // en: Plays

  editingSheet: (name: string): string => `Úprava: ${name}`, // en: `Editing ${name}`

  // --- patička seznamu -------------------------------------------------------

  // en: `Showing ${shown} of ${total} ${noun}`
  listShowing: ({
    noun: kind,
    shown,
    total,
  }: {
    noun: ListNoun;
    shown: number;
    total: number;
  }): string => {
    const verb = plural("cs", shown, {
      one: NOUNS[kind].masc ? "Zobrazen" : "Zobrazena",
      few: "Zobrazeny",
      other: "Zobrazeno",
    });
    return `${verb} ${n(shown)} z ${n(total)} ${ofTotal(kind, total)}`;
  },
  // en: `All ${total} ${noun}`
  listAll: ({ noun: kind, total }: { noun: ListNoun; total: number }): string => {
    const f = NOUNS[kind];
    return plural("cs", total, {
      one: `${n(total)} ${f.sg}`,
      few: `Všechny ${n(total)} ${f.pl}`,
      many: `Všech ${n(total)} ${f.genSg}`,
      other: `Všech ${n(total)} ${f.genPl}`,
    });
  },
  // en: `Show ${count} more ${noun}`
  listMore: ({ noun: kind, count }: { noun: ListNoun; count: number }): string => {
    const f = NOUNS[kind];
    return plural("cs", count, {
      one: `Zobrazit další ${f.accSg}`,
      few: `Zobrazit další ${n(count)} ${f.pl}`,
      many: `Zobrazit dalších ${n(count)} ${f.genSg}`,
      other: `Zobrazit dalších ${n(count)} ${f.genPl}`,
    });
  },
  // en: `Show all ${total} ${noun}`
  listShowAll: ({ noun: kind, total }: { noun: ListNoun; total: number }): string => {
    const f = NOUNS[kind];
    return plural("cs", total, {
      one: `Zobrazit ${n(total)} ${f.accSg}`,
      few: `Zobrazit všechny ${n(total)} ${f.pl}`,
      many: `Zobrazit všech ${n(total)} ${f.genSg}`,
      other: `Zobrazit všech ${n(total)} ${f.genPl}`,
    });
  },
  // en: `${from}–${to} of ${total} ${noun}`
  listRange: ({
    noun: kind,
    from,
    to,
    total,
  }: {
    noun: ListNoun;
    from: number;
    to: number;
    total: number;
  }): string => `${n(from)}–${n(to)} z ${n(total)} ${ofTotal(kind, total)}`,
  // en: `Pagination, page ${page} of ${pageCount}`
  listPagesNav: ({ page, pageCount }: { page: number; pageCount: number }): string =>
    `Stránkování, strana ${n(page)} z ${n(pageCount)}`,
  listPrevious: "Předchozí strana", // en: Previous page
  listNext: "Další strana", // en: Next page
  listTop: "Nahoru", // en: Back to top
} satisfies typeof enCommon;

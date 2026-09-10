// Pár věcí, které nepatří žádné konkrétní stránce.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání), matching the English.               │
// └────────────────────────────────────────────────────────────────────────┘
import type { common as enCommon } from "../en/common.js";

export const common = {
  // en: Something about that request looked wrong. Reload the page and try again.
  originError: "Na tom požadavku bylo něco špatně. Načti stránku znovu a zkus to zas.",

  genericError: "Nepovedlo se. Zkus to znovu.", // en: That didn't work. Try again.

  closeWithoutSaving: "Zavřít bez uložení", // en: Close without saving

  instrumentsVerb: "Nástroje", // en: Instruments
  playsVerb: "Hraje na", // en: Plays

  editingSheet: (name: string): string => `Úprava: ${name}`, // en: `Editing ${name}`
} satisfies typeof enCommon;

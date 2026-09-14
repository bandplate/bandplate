// Ověřování formulářů.
//
// ┌─ PROOFREADING ─────────────────────────────────────────────────────────┐
// │ English on each line as a trailing comment. Edit here; the edit is the  │
// │ fix. Register is INFORMAL (tykání) — these are imperatives spoken to    │
// │ one person, so "Zadej", not "Zadejte".                                  │
// └────────────────────────────────────────────────────────────────────────┘
import type { validation as enValidation } from "../en/validation.js";

export const validation = {
  generic: "Neplatný vstup.", // en: Invalid input.

  titleRequired: "Zadej název.", // en: Enter a title.
  labelRequired: "Zadej označení.", // en: Enter a label.
  slugRequired: "Zadej slug.", // en: Enter a slug.
  displayNameRequired: "Zadej jméno.", // en: Enter a display name.
  emailRequired: "Zadej e-mailovou adresu.", // en: Enter an email address.
  emailInvalid: "Zadej platnou e-mailovou adresu.", // en: Enter a valid email address.
  emailRequiredLogin: "Zadej svou e-mailovou adresu.", // en: Enter your email address.
  bootstrapTokenRequired: "Zadej bootstrap token.", // en: Enter the bootstrap token.

  heldAtRequired: "Zadej datum, kdy se to konalo.", // en: Enter the date it was held.
  recordedAtRequired: "Zadej datum nahrávky.", // en: Enter the date it was recorded.
  dateInvalid: "Tomu datu nerozumím.", // en: That date didn't look right.

  songRequired: "Vyber, o kterou skladbu jde.", // en: Choose which song this is.
  eventRequired: "Vyber, ze které akce to je.", // en: Choose which session this came from.
  kindRequired: "Vyber, co to bylo za akci.", // en: Choose what kind of session this was.
  scopeRequired: "Vyber aspoň jedno oprávnění.", // en: Choose at least one scope.

  tempoPositive: "Tempo musí být kladné číslo.", // en: Tempo has to be a positive number.
  // en: That tempo looks wrong — 400 bpm is the ceiling.
  tempoCeiling: "Takové tempo nedává smysl. Strop je 400 bpm.",

  // en: At least one of status or role is required.
  statusOrRoleRequired: "Musí být zadaný aspoň stav nebo role.",
} satisfies typeof enValidation;

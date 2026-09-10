// Form validation.
//
// --- Why these are looked up by KEY --------------------------------------
//
// Every other area in this catalog is read with a locale in hand. These
// cannot be: a zod schema is a module-level constant, built once when the
// module loads, long before any request exists. `z.string().min(1, "…")`
// bakes its message in at that moment.
//
// So the SCHEMAS carry a key — `.min(1, "titleRequired")` — and the page,
// which does have a locale, turns it into a sentence at render time.
// `validationMessage` falls back to whatever it was given, so a key that has
// never been added here renders as itself rather than as a blank field error:
// ugly, findable, and not silent.
export const validation = {
  generic: "Invalid input.",

  titleRequired: "Enter a title.",
  labelRequired: "Enter a label.",
  slugRequired: "Enter a slug.",
  displayNameRequired: "Enter a display name.",
  emailRequired: "Enter an email address.",
  emailInvalid: "Enter a valid email address.",
  emailRequiredLogin: "Enter your email address.",
  bootstrapTokenRequired: "Enter the bootstrap token.",

  heldAtRequired: "Enter the date it was held.",
  recordedAtRequired: "Enter the date it was recorded.",
  dateInvalid: "That date didn't look right.",

  songRequired: "Choose which song this is.",
  eventRequired: "Choose which session this came from.",
  kindRequired: "Choose what kind of session this was.",
  scopeRequired: "Choose at least one scope.",

  tempoPositive: "Tempo has to be a positive number.",
  tempoCeiling: "That tempo looks wrong — 400 bpm is the ceiling.",

  statusOrRoleRequired: "At least one of status or role is required.",
};

export type ValidationKey = keyof typeof validation;

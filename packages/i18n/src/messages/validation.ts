// The `validation` area, both languages, plus the resolver the pages use.
import type { Locale } from "../locale.js";
import { validation as cs } from "./cs/validation.js";
import { type ValidationKey, validation as en } from "./en/validation.js";

export type { ValidationKey };

export const validationByLocale: Record<Locale, typeof en> = { en, cs };

/**
 * Turn a schema's key into a sentence.
 *
 * Takes a plain `string` rather than a `ValidationKey`, because what arrives
 * is `issue.message` — zod types that as a string and cannot know it is one of
 * ours. An unrecognised value is returned unchanged, which means a key nobody
 * added here shows up in the field error as itself: visible and findable,
 * rather than a blank space under an input.
 */
export function validationMessage(locale: Locale, key: string): string {
  const table = validationByLocale[locale] as Record<string, string | undefined>;
  return table[key] ?? key;
}

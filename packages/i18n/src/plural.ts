// Counting things in a language that has more than two ways to do it.
//
// --- Why this is not `n === 1 ? a : b` ------------------------------------
//
// English has two forms and the whole app was written to that: `${n} ${n === 1
// ? "take" : "takes"}` appears a dozen times. Czech has FOUR CLDR categories —
// `one` (1), `few` (2-4), `many` (decimals: 1,5 skladby), `other` (0, 5, 11,
// 25) — and, separately, declines the noun after a numeral into the genitive:
// "5 skladeb", not "5 skladby".
//
// Those look like two problems and are one. The genitive plural IS what CLDR
// calls `other` for Czech, so a single record keyed by plural category covers
// both, and no separate case machinery is needed:
//
//     { one: "skladba", few: "skladby", many: "skladby", other: "skladeb" }
//
// English fills `one` and `other` and never returns anything else, so the same
// record shape serves both languages with no branching at the call site.
//
// --- Why `Intl.PluralRules` rather than a hand-written rule ---------------
//
// The rule for Czech is short enough to hand-write, and the temptation is
// real. But `Intl.PluralRules` is in the platform on both runtimes we ship to,
// it is already correct for every language somebody might add next, and it
// gets `many` right for decimals, which a hand-written `n <= 4` would not.
// There is a test in `packages/api`'s workerd suite pinning that Workers
// really does carry the ICU data for `cs` — the one place that question can
// actually be answered.
import { type Locale, intlTag } from "./locale.js";

/**
 * The forms of one countable word.
 *
 * `other` is required because every language has it and it is the fallback
 * when a category is missing; the rest are optional so an English entry can be
 * two lines rather than four identical ones.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

// One rules object per locale, not one per call. `Intl.PluralRules` is
// comparatively expensive to construct and this runs inside list rendering.
const rulesCache = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules {
  const cached = rulesCache.get(locale);
  if (cached) {
    return cached;
  }
  const rules = new Intl.PluralRules(intlTag(locale));
  rulesCache.set(locale, rules);
  return rules;
}

/** The right form of `forms` for `count`, in `locale`. */
export function plural(locale: Locale, count: number, forms: PluralForms): string {
  const category = rulesFor(locale).select(count);
  // `noUncheckedIndexedAccess` is on, so this is `string | undefined` even
  // though every category we could get back is declared — hence the `??`,
  // which is also the honest fallback for a catalog entry that only filled
  // `one` and `other`.
  return forms[category] ?? forms.other;
}

/**
 * `count` followed by the right form of the word — "1 take", "5 takeů".
 *
 * The number is formatted for the locale too, so a five-figure count reads
 * "12 345" in Czech rather than "12,345".
 */
export function countOf(locale: Locale, count: number, forms: PluralForms): string {
  return `${formatNumber(locale, count)} ${plural(locale, count, forms)}`;
}

const numberFormatCache = new Map<Locale, Intl.NumberFormat>();

/** Plain integer/decimal formatting — Czech groups with a space and decimalises with a comma. */
export function formatNumber(locale: Locale, value: number): string {
  const cached = numberFormatCache.get(locale);
  if (cached) {
    return cached.format(value);
  }
  const formatter = new Intl.NumberFormat(intlTag(locale));
  numberFormatCache.set(locale, formatter);
  return formatter.format(value);
}

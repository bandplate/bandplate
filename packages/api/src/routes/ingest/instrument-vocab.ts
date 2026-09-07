// Instrument-slug validation — contract v1 §7: "an unknown slug is
// rejected with 422 listing the valid ones", deliberately never
// auto-created (Reaper track names are messy; letting one silently become
// a new instrument would corrupt the filter vocabulary within one
// rehearsal).
import { type Db, instrumentsRepo } from "@bandplate/db";

export interface InstrumentVocab {
  /** slug -> instrument row, active (non-archived) only. */
  bySlug: Map<string, instrumentsRepo.Instrument>;
  validSlugs: string[];
}

export async function loadInstrumentVocab(db: Db): Promise<InstrumentVocab> {
  const rows = await instrumentsRepo.list(db);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return { bySlug, validSlugs: [...bySlug.keys()].sort() };
}

/** Every slug in `slugs` not present in the vocabulary, de-duplicated, in input order. */
export function unknownSlugs(vocab: InstrumentVocab, slugs: string[]): string[] {
  const seen = new Set<string>();
  const unknown: string[] = [];
  for (const slug of slugs) {
    if (!vocab.bySlug.has(slug) && !seen.has(slug)) {
      seen.add(slug);
      unknown.push(slug);
    }
  }
  return unknown;
}

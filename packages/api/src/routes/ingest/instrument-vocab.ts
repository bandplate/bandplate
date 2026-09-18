// Instrument-slug validation — contract v1 §7.
//
// An unknown slug is rejected with 422 listing the valid ones, UNLESS the
// declaration opted in to `createMissingInstruments`, in which case it
// becomes a stub.
//
// The original ruling was that unknown slugs are never auto-created: Reaper
// track names are messy, and letting `BASS DI 2` silently become a new
// instrument would corrupt the filter vocabulary within one rehearsal. That
// objection is answered by the stub, not by the refusal — an auto-created row
// arrives with no icon, no colour, a label taken from its own slug, and a
// flag that says so in the admin table until a human finishes it. The refusal
// is still the default, so a bridge that ships a mapping file keeps exactly
// the protection it had.
import { type Db, instrumentsRepo } from "@bandplate/db";

export interface InstrumentVocab {
  /**
   * Every slug that resolves, canonical or alias -> the instrument row.
   *
   * Aliases are IN here, and they have to be: an instrument merged into
   * another leaves its old slug behind as an alias precisely so the next
   * bridge run keeps working. Resolving against canonical slugs alone would
   * make every merge last exactly until the next ingest, which would then
   * re-create the row the merge removed.
   */
  bySlug: Map<string, instrumentsRepo.Instrument>;
  /**
   * Every slug the server accepts, canonical and alias alike — the list a 422
   * hands back.
   *
   * An alias is another name for an instrument, not a legacy shim, so it is
   * advertised wherever accepted slugs are: here and in
   * `GET /ingest/v1/instruments`. Listing canonical slugs alone told a bridge
   * that a slug the server would take was invalid, and a bridge that checks
   * up front believed it.
   */
  validSlugs: string[];
}

export async function loadInstrumentVocab(db: Db): Promise<InstrumentVocab> {
  const [rows, aliases] = await Promise.all([
    instrumentsRepo.list(db),
    instrumentsRepo.listAllAliases(db),
  ]);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const alias of aliases) {
    const target = byId.get(alias.instrumentId);
    // An alias of an ARCHIVED instrument does not resolve: `list` excludes
    // those, so the target is absent here. That is the right answer — an
    // archived instrument is not a choice for a new take, and an alias must
    // not be a side door around that.
    if (target && !bySlug.has(alias.slug)) {
      bySlug.set(alias.slug, target);
    }
  }
  return { bySlug, validSlugs: [...bySlug.keys()].sort() };
}

/**
 * A label to show until someone writes a real one.
 *
 * `drums-subkick` -> `Drums Subkick`. Deliberately plain: it must not look
 * like a considered name, because it is not one — the point of a stub is that
 * the admin table shows something obviously unfinished.
 */
export function stubLabelFromSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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

// Words about events, shared by home, `/events`, `/takes` and a take's own
// page — anywhere a rehearsal, concert or studio date is named.
import { plural } from "../../plural.js";

/**
 * The one word a row shows for an event's kind.
 *
 * `concert` reads as "live" because that is what the band calls it; the other
 * two are already the word they would use.
 *
 * ANYTHING UNRECOGNISED PASSES THROUGH AS ITSELF. `events.kind` is a plain
 * `string` in the schema — an admin-editable vocabulary was always the intent
 * — so a kind this map has never heard of renders as whatever the admin typed
 * rather than as a fallback that would hide it. That is why this is a function
 * with a lookup inside rather than a `Record`: a `Record` would have to be
 * total, and this deliberately is not.
 */
const KIND_WORDS: Record<string, string> = {
  rehearsal: "rehearsal",
  concert: "live",
  session: "session",
};

export const events = {
  kindLabel: (kind: string): string => KIND_WORDS[kind] ?? kind,

  /**
   * An event with no venue and no title.
   *
   * "Unnamed", not an em dash: most rehearsals have neither, and a column of
   * dashes reads as missing data rather than as the normal case.
   */
  unnamed: "Unnamed",

  /** The ledger's footer button on home. */
  allEvents: "All events",

  /** "3 takes" — the count under a plate, and in the ledger. */
  takeCount: (count: number): string =>
    `${count} ${plural("en", count, { one: "take", other: "takes" })}`,
};

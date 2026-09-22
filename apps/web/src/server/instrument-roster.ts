// Which glyphs a take row draws when it shows the band's whole line-up.
//
// A take row used to draw only the instruments on the take. The line-up is
// how members choose a take ("the one with the clarinet", "the one without
// drums"), and a run of three glyphs next to a run of seven gave the eye
// nothing to compare: every row was a different shape. So the row now draws
// the band's roster, always in the same order, with the instruments that
// play drawn solid and the rest ghosted. Position does the remembering, the
// way it does for a mixer's lanes, and an absence reads as a gap instead of
// something to count.
//
// The roster is built once per LIST (`pageRoster`), not per row: the
// admin's active instruments in their sort order, plus anything a take on
// the page has that the active list does not (an archived instrument, a
// stub a bridge created for a track name it did not recognise). Built per
// row, a take with the archived trombone drew seven slots under rows of six,
// and the columns stopped lining up, which is the whole point. Stubs that no
// take on the page uses are left out: they are not part of the band until an
// admin names them.
//
// Instruments that share a glyph collapse to one slot, the same rule
// `InstrumentSet` applies to a plain set: the admin chose the same drawing,
// which is their statement that they look alike.

export interface RosterInstrument {
  id: string;
  label: string;
  icon: string | null;
  isStub?: boolean;
}

export interface RosterSlot<T extends RosterInstrument> {
  /** The instrument whose glyph is drawn. */
  instrument: T;
  /** True when the take has any instrument behind this slot. */
  present: boolean;
  /** Every instrument behind the slot that the take has, else the roster's. */
  labels: string[];
}

export function rosterSlots<T extends RosterInstrument>(
  roster: readonly T[],
  onTake: readonly T[],
  markOf: (instrument: T) => string,
): RosterSlot<T>[] {
  const takeMarks = new Map<string, T[]>();
  for (const instrument of onTake) {
    const key = markOf(instrument);
    takeMarks.set(key, [...(takeMarks.get(key) ?? []), instrument]);
  }

  const slots = new Map<string, RosterSlot<T>>();
  for (const instrument of roster) {
    const key = markOf(instrument);
    const existing = slots.get(key);
    if (existing) {
      if (!existing.present) {
        existing.labels.push(instrument.label);
      }
      continue;
    }
    const playing = takeMarks.get(key);
    slots.set(key, {
      instrument: playing?.[0] ?? instrument,
      present: playing !== undefined,
      labels: playing ? playing.map((i) => i.label) : [instrument.label],
    });
  }
  for (const [key, playing] of takeMarks) {
    if (!slots.has(key)) {
      slots.set(key, {
        instrument: playing[0] as T,
        present: true,
        labels: playing.map((i) => i.label),
      });
    }
  }

  // No cap: dropping absent slots per row would give rows different widths,
  // the very thing the roster exists to prevent.
  return [...slots.values()];
}

/**
 * One roster for every row of a list: the active instruments (minus stubs no
 * take here uses), then whatever else the listed takes carry, in sort order.
 */
export function pageRoster<T extends RosterInstrument & { sortOrder: number }>(
  active: readonly T[],
  takes: readonly (readonly T[])[],
): T[] {
  const used = new Map<string, T>();
  for (const instruments of takes) {
    for (const instrument of instruments) {
      used.set(instrument.id, instrument);
    }
  }
  const activeIds = new Set(active.map((i) => i.id));
  const roster = active.filter((i) => !i.isStub || used.has(i.id));
  const extra = [...used.values()]
    .filter((i) => !activeIds.has(i.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return [...roster, ...extra].sort((a, b) => a.sortOrder - b.sortOrder);
}

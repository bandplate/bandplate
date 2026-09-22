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
// The roster is the admin's active instrument list, in its sort order.
// Stubs (created by a bridge for a track name it did not recognise) are left
// out unless the take has one; they are not part of the band until an admin
// names them. An instrument the take has but the roster does not (archived
// since) is appended as present, so nothing recorded ever disappears.
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

/** More slots than this and the absent ones drop off the end first. */
export const MAX_ROSTER_SLOTS = 8;

export function rosterSlots<T extends RosterInstrument>(
  roster: readonly T[],
  onTake: readonly T[],
  markOf: (instrument: T) => string,
  max: number = MAX_ROSTER_SLOTS,
): RosterSlot<T>[] {
  const takeIds = new Set(onTake.map((i) => i.id));
  const takeMarks = new Map<string, T[]>();
  for (const instrument of onTake) {
    const key = markOf(instrument);
    takeMarks.set(key, [...(takeMarks.get(key) ?? []), instrument]);
  }

  const slots = new Map<string, RosterSlot<T>>();
  for (const instrument of roster) {
    if (instrument.isStub && !takeIds.has(instrument.id)) {
      continue;
    }
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

  const all = [...slots.values()];
  let overflow = all.length - max;
  if (overflow <= 0) {
    return all;
  }
  const kept: RosterSlot<T>[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const slot = all[i] as RosterSlot<T>;
    if (overflow > 0 && !slot.present) {
      overflow--;
      continue;
    }
    kept.unshift(slot);
  }
  return kept;
}

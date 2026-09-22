import { describe, expect, it } from "vitest";
import { type RosterInstrument, rosterSlots } from "./instrument-roster.js";

const inst = (id: string, icon: string | null = id, isStub = false): RosterInstrument => ({
  id,
  label: id.toUpperCase(),
  icon,
  isStub,
});
const mark = (i: RosterInstrument) => i.icon ?? `initials:${i.id}`;

const drums = inst("drums");
const bass = inst("bass");
const guitar = inst("guitar");
const vocals = inst("vocals");
const ROSTER = [drums, bass, guitar, vocals];

const shape = (slots: ReturnType<typeof rosterSlots>) =>
  slots.map((s) => `${s.instrument.id}${s.present ? "+" : "-"}`);

describe("rosterSlots", () => {
  it("draws the whole roster in its order, marking who plays", () => {
    expect(shape(rosterSlots(ROSTER, [vocals, guitar], mark))).toEqual([
      "drums-",
      "bass-",
      "guitar+",
      "vocals+",
    ]);
  });

  it("appends an instrument the roster no longer has, as present", () => {
    const horn = inst("horn");
    expect(shape(rosterSlots(ROSTER, [horn], mark))).toEqual([
      "drums-",
      "bass-",
      "guitar-",
      "vocals-",
      "horn+",
    ]);
  });

  it("leaves stubs out unless the take has them", () => {
    const stub = inst("mystery", null, true);
    expect(shape(rosterSlots([...ROSTER, stub], [drums], mark))).toHaveLength(4);
    expect(shape(rosterSlots([...ROSTER, stub], [stub], mark))).toContain("mystery+");
  });

  it("collapses instruments that share a glyph into one slot", () => {
    const liveBass = { ...inst("live-bass"), icon: "bass" };
    const slots = rosterSlots([drums, bass, liveBass], [liveBass], mark);
    expect(shape(slots)).toEqual(["drums-", "live-bass+"]);
    expect(slots[1]?.labels).toEqual(["LIVE-BASS"]);
  });

  it("drops absent slots from the end first when over the cap", () => {
    const big = ["a", "b", "c", "d", "e"].map((id) => inst(id));
    expect(shape(rosterSlots(big, [big[4] as RosterInstrument], mark, 3))).toEqual([
      "a-",
      "b-",
      "e+",
    ]);
  });

  it("never drops a present slot, even over the cap", () => {
    const big = ["a", "b", "c"].map((id) => inst(id));
    expect(shape(rosterSlots(big, big, mark, 2))).toEqual(["a+", "b+", "c+"]);
  });
});

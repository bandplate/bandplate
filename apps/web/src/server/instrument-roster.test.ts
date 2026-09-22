import { describe, expect, it } from "vitest";
import { pageRoster, type RosterInstrument, rosterSlots } from "./instrument-roster.js";

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

  it("collapses instruments that share a glyph into one slot", () => {
    const liveBass = { ...inst("live-bass"), icon: "bass" };
    const slots = rosterSlots([drums, bass, liveBass], [liveBass], mark);
    expect(shape(slots)).toEqual(["drums-", "live-bass+"]);
    expect(slots[1]?.labels).toEqual(["LIVE-BASS"]);
  });
});

describe("pageRoster", () => {
  const at = (id: string, sortOrder: number, isStub = false) => ({
    ...inst(id, id, isStub),
    sortOrder,
  });
  const d = at("drums", 0);
  const b = at("bass", 1);
  const tb = at("trombone", 6);
  const stub = at("mystery", 9, true);

  it("adds an archived instrument a listed take uses, in sort order, for every row", () => {
    const roster = pageRoster([d, b], [[d], [b, tb]]);
    expect(roster.map((i) => i.id)).toEqual(["drums", "bass", "trombone"]);
    // Every row then draws the same three slots, present or not.
    expect(shape(rosterSlots(roster, [d], mark))).toEqual(["drums+", "bass-", "trombone-"]);
  });

  it("keeps a stub only when a listed take uses it", () => {
    expect(pageRoster([d, stub], [[d]]).map((i) => i.id)).toEqual(["drums"]);
    expect(pageRoster([d, stub], [[d], [stub]]).map((i) => i.id)).toEqual(["drums", "mystery"]);
  });
});

import { describe, expect, it } from "vitest";
import { decidePlayerClickAction } from "./player-actions.js";
import type { PlayerTrack } from "./player-store.js";

const master: PlayerTrack = {
  takeId: "take-1",
  title: "Neon Skyline",
  subtitle: "rehearsal — Aug 12",
  sourceAssetId: "asset-master",
  sourceKind: "master",
  sourceName: "",
};

describe("decidePlayerClickAction", () => {
  it("nothing is loaded yet -> starts the clicked track", () => {
    const action = decidePlayerClickAction(null, {
      takeId: "take-1",
      assetId: "asset-master",
      title: "Neon Skyline",
      subtitle: "rehearsal — Aug 12",
      sourceKind: "master",
      sourceName: "",
      role: "toggle",
    });
    expect(action).toEqual({
      kind: "start-track",
      track: master,
    });
  });

  it("clicking the exact source already loaded via the plain toggle -> toggle-playback, not a reload", () => {
    const action = decidePlayerClickAction(master, {
      takeId: "take-1",
      assetId: "asset-master",
      title: "Neon Skyline",
      subtitle: "rehearsal — Aug 12",
      sourceKind: "master",
      sourceName: "",
      role: "toggle",
    });
    expect(action).toEqual({ kind: "toggle-playback" });
  });

  it("clicking a SOURCE-SELECT chip for the source that's already selected -> no-op, does not pause (review item 12)", () => {
    const action = decidePlayerClickAction(master, {
      takeId: "take-1",
      assetId: "asset-master",
      title: "Neon Skyline",
      subtitle: "rehearsal — Aug 12",
      sourceKind: "master",
      sourceName: "",
      role: "source-select",
    });
    expect(action).toEqual({ kind: "noop" });
  });

  it("clicking a DIFFERENT source on the SAME take -> switch-source, preserving position, keeping title/subtitle/takeId", () => {
    const action = decidePlayerClickAction(master, {
      takeId: "take-1",
      assetId: "asset-bass-stem",
      title: "Neon Skyline",
      subtitle: "rehearsal — Aug 12",
      sourceKind: "stem",
      sourceName: "Bass",
      role: "source-select",
    });
    expect(action).toEqual({
      kind: "switch-source",
      preservePosition: true,
      track: {
        takeId: "take-1",
        title: "Neon Skyline",
        subtitle: "rehearsal — Aug 12",
        sourceAssetId: "asset-bass-stem",
        sourceKind: "stem",
        sourceName: "Bass",
      },
    });
  });

  it("switching source keeps the ORIGINAL title/subtitle even if the clicked element's own data differs (defensive: the take identity wins)", () => {
    const action = decidePlayerClickAction(master, {
      takeId: "take-1",
      assetId: "asset-bass-stem",
      title: "Stale Title From A Different Render",
      subtitle: "stale subtitle",
      sourceKind: "stem",
      sourceName: "Bass",
      role: "source-select",
    });
    expect(action.kind).toBe("switch-source");
    if (action.kind === "switch-source") {
      expect(action.track.title).toBe("Neon Skyline");
      expect(action.track.subtitle).toBe("rehearsal — Aug 12");
    }
  });

  it("clicking a control for a DIFFERENT take entirely -> start-track, discarding the old track", () => {
    const action = decidePlayerClickAction(master, {
      takeId: "take-2",
      assetId: "asset-2-master",
      title: "Basement Tapes",
      subtitle: "concert — Sep 1",
      sourceKind: "master",
      sourceName: "",
      role: "toggle",
    });
    expect(action).toEqual({
      kind: "start-track",
      track: {
        takeId: "take-2",
        title: "Basement Tapes",
        subtitle: "concert — Sep 1",
        sourceAssetId: "asset-2-master",
        sourceKind: "master",
        sourceName: "",
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import { controlState, decidePlayerClickAction } from "./player-actions.js";
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

  it("the plain toggle of the take while one of its STEMS plays -> toggle-playback, not a swap back to the master", () => {
    const bass: PlayerTrack = {
      ...master,
      sourceAssetId: "asset-bass-stem",
      sourceKind: "stem",
      sourceName: "Bass",
    };
    const action = decidePlayerClickAction(bass, {
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

describe("controlState", () => {
  const bass: PlayerTrack = {
    ...master,
    sourceAssetId: "asset-bass-stem",
    sourceKind: "stem",
    sourceName: "Bass",
  };
  const rowToggle = { takeId: "take-1", assetId: "asset-master", role: "toggle" };
  const masterPill = { takeId: "take-1", assetId: "asset-master", role: "source-select" };
  const bassPill = { takeId: "take-1", assetId: "asset-bass-stem", role: "source-select" };

  it("nothing loaded -> nothing pressed, nothing current", () => {
    expect(controlState(null, false, rowToggle)).toEqual({
      pressed: false,
      selected: false,
      currentTake: false,
      playing: false,
    });
  });

  it("a row toggle reads as playing while a STEM of its take plays", () => {
    expect(controlState(bass, true, rowToggle)).toEqual({
      pressed: true,
      selected: false,
      currentTake: true,
      playing: true,
    });
  });

  it("a row toggle of the current take, paused -> not pressed, still the current take", () => {
    expect(controlState(master, false, rowToggle)).toEqual({
      pressed: false,
      selected: true,
      currentTake: true,
      playing: false,
    });
  });

  it("another take's toggle is untouched", () => {
    const other = { takeId: "take-2", assetId: "asset-2-master", role: "toggle" };
    expect(controlState(master, true, other)).toEqual({
      pressed: false,
      selected: false,
      currentTake: false,
      playing: false,
    });
  });

  it("a source pill is pressed when selected, paused or not", () => {
    expect(controlState(bass, false, bassPill).pressed).toBe(true);
    expect(controlState(bass, true, bassPill)).toEqual({
      pressed: true,
      selected: true,
      currentTake: true,
      playing: true,
    });
  });

  it("an unselected source pill of the playing take is not pressed", () => {
    expect(controlState(bass, true, masterPill)).toEqual({
      pressed: false,
      selected: false,
      currentTake: true,
      playing: false,
    });
  });
});

describe("a recording that is still only on this device", () => {
  const local = {
    takeId: "stash-local:l-1",
    assetId: "stash-local:l-1",
    title: "nápad na mezihru",
    subtitle: "Čoudy",
    sourceKind: "master" as const,
    sourceName: "",
    role: "toggle",
    src: "blob:https://example.test/abc",
  };

  it("starts from the URL its row owns, not from an asset route", () => {
    const action = decidePlayerClickAction(null, local);
    expect(action).toEqual({
      kind: "start-track",
      track: {
        takeId: "stash-local:l-1",
        title: "nápad na mezihru",
        subtitle: "Čoudy",
        sourceAssetId: "stash-local:l-1",
        sourceKind: "master",
        sourceName: "",
        src: "blob:https://example.test/abc",
      },
    });
  });

  it("hands the next take back to the asset route rather than keeping the blob", () => {
    const playingLocal = {
      takeId: "stash-local:l-1",
      title: "nápad na mezihru",
      subtitle: "Čoudy",
      sourceAssetId: "stash-local:l-1",
      sourceKind: "master" as const,
      sourceName: "",
      src: "blob:https://example.test/abc",
    };
    const server = {
      takeId: "take-9",
      assetId: "asset-9",
      title: "Čoudy",
      subtitle: "",
      sourceKind: "master" as const,
      sourceName: "",
      role: "toggle",
    };
    const action = decidePlayerClickAction(playingLocal, server);
    expect(action.kind).toBe("start-track");
    expect(action.kind === "start-track" && action.track.src).toBeUndefined();
  });
});

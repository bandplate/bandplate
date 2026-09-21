import { playerMessages } from "@bandplate/i18n";
import { describe, expect, it } from "vitest";
import type { PlayQueue, QueueItem } from "./player-queue.js";
import type { PlayerSource, PlayerTrack } from "./player-store.js";
import {
  controlDropsFocus,
  drawnBarCount,
  nowPlayingAnnouncement,
  playerSubtitle,
  queueableItem,
  readSourceControl,
  remoteTransport,
  showsMixer,
} from "./player-view.js";

const t = playerMessages("en");

const master: PlayerTrack = {
  takeId: "t-1",
  title: "Čoudy",
  subtitle: "Rehearsal, 3 May",
  sourceAssetId: "a-master",
  sourceKind: "master",
  sourceName: "",
};
const bassSolo: PlayerTrack = {
  ...master,
  sourceAssetId: "a-bass",
  sourceKind: "stem",
  sourceName: "Bass",
};

function item(takeId: string): QueueItem {
  return { takeId, assetId: `a-${takeId}`, title: takeId, subtitle: "" };
}
function queueOf(length: number, index: number): PlayQueue {
  return { items: Array.from({ length }, (_, i) => item(`t-${i + 1}`)), index };
}

describe("readSourceControl", () => {
  it("reads a control's data-* attributes", () => {
    expect(
      readSourceControl({
        takeId: "t-1",
        assetId: "a-bass",
        title: "Čoudy",
        subtitle: "Rehearsal",
        sourceKind: "stem",
        sourceName: "Bass",
        role: "source-select",
        audioSrc: "blob:x",
      }),
    ).toEqual({
      takeId: "t-1",
      assetId: "a-bass",
      title: "Čoudy",
      subtitle: "Rehearsal",
      sourceKind: "stem",
      sourceName: "Bass",
      role: "source-select",
      src: "blob:x",
    });
  });

  it("reads a control that says nothing about its source as the master toggle", () => {
    // Every plain play button on a row or a plate is exactly that.
    expect(readSourceControl({ takeId: "t-1", assetId: "a-1", title: "Čoudy" })).toEqual({
      takeId: "t-1",
      assetId: "a-1",
      title: "Čoudy",
      subtitle: "",
      sourceKind: "master",
      sourceName: "",
      role: "toggle",
      src: undefined,
    });
  });

  it("does not trust an unknown kind to be a stem", () => {
    expect(
      readSourceControl({ takeId: "t", assetId: "a", title: "x", sourceKind: "STEM" })?.sourceKind,
    ).toBe("master");
  });

  it("is nothing without a take, an asset and a title", () => {
    expect(readSourceControl({ assetId: "a", title: "x" })).toBeNull();
    expect(readSourceControl({ takeId: "t", title: "x" })).toBeNull();
    expect(readSourceControl({ takeId: "t", assetId: "a", title: "" })).toBeNull();
  });
});

describe("queueableItem", () => {
  const base = {
    takeId: "t-1",
    assetId: "a-1",
    title: "Čoudy",
    subtitle: "",
    sourceKind: "master" as const,
    sourceName: "",
    role: "toggle",
  };

  it("queues a take row's master toggle", () => {
    expect(queueableItem({ ...base, src: "blob:y" })).toEqual({
      takeId: "t-1",
      assetId: "a-1",
      title: "Čoudy",
      subtitle: "",
      src: "blob:y",
    });
  });

  it("skips a source pill and a stem: a queued take always starts on its master", () => {
    expect(queueableItem({ ...base, role: "source-select" })).toBeNull();
    expect(queueableItem({ ...base, sourceKind: "stem" })).toBeNull();
  });
});

describe("nowPlayingAnnouncement", () => {
  it("says nothing when nothing is loaded", () => {
    expect(nowPlayingAnnouncement(null, t)).toBe("");
  });
  it("names the take for the master", () => {
    expect(nowPlayingAnnouncement(master, t)).toBe("Now playing: Čoudy");
  });
  it("names the instrument too for a stem, since a switch is a track change to a listener", () => {
    expect(nowPlayingAnnouncement(bassSolo, t)).toBe("Now playing: Čoudy — Solo: Bass");
  });
});

describe("playerSubtitle", () => {
  const two: PlayerSource[] = [
    { assetId: "a-master", kind: "master", label: "Master", icon: null },
    { assetId: "a-bass", kind: "stem", label: "Bass", icon: "bass" },
  ];

  it("is the take's own subtitle when there is nothing to choose between", () => {
    expect(playerSubtitle({ track: master, sources: null, queue: null, t })).toBe(
      "Rehearsal, 3 May",
    );
    expect(playerSubtitle({ track: master, sources: two.slice(0, 1), queue: null, t })).toBe(
      "Rehearsal, 3 May",
    );
  });

  it("names the source once there is more than one", () => {
    expect(playerSubtitle({ track: master, sources: two, queue: null, t })).toBe(
      "Rehearsal, 3 May · Master",
    );
    expect(playerSubtitle({ track: bassSolo, sources: two, queue: null, t })).toBe(
      "Rehearsal, 3 May · Bass",
    );
  });

  it("says where the take sits in a queue of more than one", () => {
    expect(playerSubtitle({ track: master, sources: two, queue: queueOf(10, 2), t })).toBe(
      "Rehearsal, 3 May · Master · 3 of 10",
    );
    expect(playerSubtitle({ track: master, sources: null, queue: queueOf(1, 0), t })).toBe(
      "Rehearsal, 3 May",
    );
  });

  it("leaves out an empty take subtitle rather than leading with a separator", () => {
    expect(
      playerSubtitle({ track: { ...master, subtitle: "" }, sources: two, queue: null, t }),
    ).toBe("Master");
    expect(playerSubtitle({ track: null, sources: null, queue: null, t })).toBe("");
  });
});

describe("showsMixer", () => {
  it("offers the mixer from two stems, and not before the list has arrived", () => {
    const stem = (id: string): PlayerSource => ({
      assetId: id,
      kind: "stem",
      label: id,
      icon: null,
    });
    const masterSource: PlayerSource = {
      assetId: "m",
      kind: "master",
      label: "Master",
      icon: null,
    };
    expect(showsMixer(null)).toBe(false);
    expect(showsMixer([masterSource, stem("a")])).toBe(false);
    expect(showsMixer([masterSource, stem("a"), stem("b")])).toBe(true);
  });
});

describe("controlDropsFocus", () => {
  it("is true for Next when the move lands on the last take", () => {
    // A focused button that becomes disabled drops focus to <body>.
    expect(controlDropsFocus(queueOf(3, 2), "next")).toBe(true);
    expect(controlDropsFocus(queueOf(3, 1), "next")).toBe(false);
  });

  it("is true for Previous when the move lands on the first take", () => {
    expect(controlDropsFocus(queueOf(3, 0), "previous")).toBe(true);
    expect(controlDropsFocus(queueOf(3, 1), "previous")).toBe(false);
  });

  it("is false for anything that is not a transport skip", () => {
    expect(controlDropsFocus(queueOf(3, 2), null)).toBe(false);
  });
});

describe("drawnBarCount", () => {
  it("draws as many bars as there is room for, up to what the file has", () => {
    expect(drawnBarCount(200, 1000)).toBe(200);
    // More bars than samples would only repeat buckets.
    expect(drawnBarCount(200, 50)).toBe(50);
    expect(drawnBarCount(200, 0)).toBe(1);
  });
});

describe("remoteTransport", () => {
  it("offers nothing to the lock screen with nothing loaded", () => {
    expect(remoteTransport(null, queueOf(3, 0))).toEqual({ previous: false, next: false });
  });

  it("always offers Previous (it restarts) and Next only when there is a next", () => {
    expect(remoteTransport(master, queueOf(3, 0))).toEqual({ previous: true, next: true });
    expect(remoteTransport(master, queueOf(3, 2))).toEqual({ previous: true, next: false });
    expect(remoteTransport(master, null)).toEqual({ previous: true, next: false });
  });
});

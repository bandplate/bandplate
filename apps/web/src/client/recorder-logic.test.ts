import { describe, expect, it } from "vitest";
import {
  type RecorderState,
  filterSongs,
  formatElapsed,
  initialRecorderState,
  levelFromTimeDomain,
  needsDurationFix,
  pickRecorderMime,
  pickerGroups,
  reduceRecorder,
  shapeForMime,
  waveformBars,
} from "./recorder-logic.js";

describe("pickRecorderMime", () => {
  it("prefers AAC in MP4, which every browser in the band can play back", () => {
    expect(pickRecorderMime(() => true)).toBe("audio/mp4;codecs=mp4a.40.2");
  });
  it("falls back to Opus in WebM where MP4 is not offered (Firefox, older Chrome)", () => {
    expect(pickRecorderMime((m) => m.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
  });
  it("says so when the browser can record none of them", () => {
    expect(pickRecorderMime(() => false)).toBeNull();
  });
});

describe("shapeForMime", () => {
  it("maps what MediaRecorder reports to a stored format, ignoring codec parameters", () => {
    expect(shapeForMime("audio/webm;codecs=opus")).toEqual({
      format: "webm",
      contentType: "audio/webm",
      extension: "webm",
    });
    expect(shapeForMime("audio/mp4")).toEqual({
      format: "m4a",
      contentType: "audio/mp4",
      extension: "m4a",
    });
    expect(shapeForMime("AUDIO/MP4; codecs=mp4a.40.2")?.format).toBe("m4a");
    expect(shapeForMime("video/webm")).toBeNull();
  });
  it("only WebM needs its duration written in afterwards", () => {
    expect(needsDurationFix("audio/webm;codecs=opus")).toBe(true);
    expect(needsDurationFix("audio/mp4")).toBe(false);
  });
});

describe("reduceRecorder", () => {
  const picked = (): RecorderState =>
    reduceRecorder(initialRecorderState(null), { type: "select", songId: "s-1" });

  it("starts on the picker, or armed when the song came with the link", () => {
    expect(initialRecorderState(null).phase).toBe("pick");
    expect(initialRecorderState("s-1")).toMatchObject({ phase: "armed", songId: "s-1" });
  });

  it("will not start without a song", () => {
    expect(reduceRecorder(initialRecorderState(null), { type: "start" }).phase).toBe("pick");
    expect(reduceRecorder(picked(), { type: "start" }).phase).toBe("starting");
  });

  it("runs the clock from the moment recording actually started", () => {
    let s = reduceRecorder(picked(), { type: "start" });
    s = reduceRecorder(s, { type: "started", at: 1_000 });
    expect(s).toMatchObject({ phase: "recording", startedAt: 1_000, elapsedMs: 0 });
    s = reduceRecorder(s, { type: "tick", now: 43_500 });
    expect(s.elapsedMs).toBe(42_500);
    s = reduceRecorder(s, { type: "stop", now: 44_000 });
    expect(s).toMatchObject({ phase: "finishing", elapsedMs: 43_000 });
    expect(reduceRecorder(s, { type: "finished" }).phase).toBe("review");
  });

  it("× asks first, and the recording keeps running while it asks", () => {
    let s = reduceRecorder(reduceRecorder(picked(), { type: "start" }), { type: "started", at: 0 });
    s = reduceRecorder(s, { type: "cancel" });
    expect(s.phase).toBe("confirm-discard");
    s = reduceRecorder(s, { type: "tick", now: 5_000 });
    expect(s.elapsedMs).toBe(5_000);
    expect(reduceRecorder(s, { type: "keep-going" }).phase).toBe("recording");
    expect(reduceRecorder(s, { type: "discard" })).toMatchObject({
      phase: "armed",
      songId: "s-1",
      elapsedMs: 0,
    });
  });

  it("Znovu goes straight back to recording the same song", () => {
    const review: RecorderState = {
      phase: "review",
      songId: "s-1",
      startedAt: 0,
      elapsedMs: 9_000,
      error: null,
    };
    expect(reduceRecorder(review, { type: "start" })).toMatchObject({
      phase: "starting",
      songId: "s-1",
      elapsedMs: 0,
    });
  });

  it("a failed save returns to the review with the error, keeping the recording", () => {
    const saving = reduceRecorder(
      { phase: "review", songId: "s-1", startedAt: 0, elapsedMs: 9_000, error: null },
      { type: "save" },
    );
    expect(saving.phase).toBe("saving");
    expect(reduceRecorder(saving, { type: "failed", error: "save-failed" })).toMatchObject({
      phase: "review",
      error: "save-failed",
      elapsedMs: 9_000,
    });
  });

  it("a microphone that will not open is an error you can retry from", () => {
    const s = reduceRecorder(reduceRecorder(picked(), { type: "start" }), {
      type: "failed",
      error: "denied",
    });
    expect(s).toMatchObject({ phase: "error", error: "denied" });
    expect(reduceRecorder(s, { type: "start" }).phase).toBe("starting");
  });

  it("a stop the recorder made itself finishes the take, and a second stop changes nothing", () => {
    // A phone call or a pulled headset ends the tracks: onstop fires while
    // the phase is still recording, and the island dispatches the stop itself.
    let s = reduceRecorder(reduceRecorder(picked(), { type: "start" }), {
      type: "started",
      at: 1_000,
    });
    s = reduceRecorder(s, { type: "stop", now: 31_000 });
    expect(s).toMatchObject({ phase: "finishing", elapsedMs: 30_000 });
    // The pressed Stop already moved it to finishing; the onstop dispatch
    // that follows must not move the clock.
    expect(reduceRecorder(s, { type: "stop", now: 32_000 })).toBe(s);
    expect(reduceRecorder(s, { type: "finished" }).phase).toBe("review");
  });

  it("a stop the recorder made itself during the discard question still keeps the take", () => {
    let s = reduceRecorder(reduceRecorder(picked(), { type: "start" }), { type: "started", at: 0 });
    s = reduceRecorder(s, { type: "cancel" });
    expect(reduceRecorder(s, { type: "stop", now: 8_000 })).toMatchObject({
      phase: "finishing",
      elapsedMs: 8_000,
    });
  });

  it("ignores an event that does not belong to the phase", () => {
    const s = picked();
    expect(reduceRecorder(s, { type: "stop", now: 5 })).toBe(s);
    expect(reduceRecorder(s, { type: "tick", now: 5 })).toBe(s);
  });
});

describe("formatElapsed", () => {
  it("reads as minutes and seconds, and hours only when there are some", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(42_900)).toBe("0:42");
    expect(formatElapsed(62_000)).toBe("1:02");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("levelFromTimeDomain", () => {
  it("is 0 for silence, 1 for a full-scale signal, and rises with loudness", () => {
    expect(levelFromTimeDomain(new Uint8Array(64).fill(128))).toBe(0);
    const full = new Uint8Array(64).map((_, i) => (i % 2 === 0 ? 0 : 255));
    expect(levelFromTimeDomain(full)).toBe(1);
    const quiet = new Uint8Array(64).map((_, i) => (i % 2 === 0 ? 120 : 136));
    const louder = new Uint8Array(64).map((_, i) => (i % 2 === 0 ? 96 : 160));
    expect(levelFromTimeDomain(quiet)).toBeGreaterThan(0);
    expect(levelFromTimeDomain(louder)).toBeGreaterThan(levelFromTimeDomain(quiet));
    expect(levelFromTimeDomain(new Uint8Array(0))).toBe(0);
  });
});

describe("waveformBars", () => {
  it("takes the peak of each slice and scales the loudest to 1", () => {
    const samples = new Float32Array([0.1, -0.2, 0.05, 0.4, -0.1, 0.1, 0, 0]);
    expect(waveformBars(samples, 4)).toEqual([0.5, 1, 0.25, 0]);
  });
  it("is empty for no audio or no bars, and all zeros for silence", () => {
    expect(waveformBars(new Float32Array(0), 8)).toEqual([]);
    expect(waveformBars(new Float32Array(4), 0)).toEqual([]);
    expect(waveformBars(new Float32Array(4), 2)).toEqual([0, 0]);
  });
});

describe("filterSongs", () => {
  const songs = [
    { id: "1", title: "Přítel o cestách", slug: "pritel" },
    { id: "2", title: "Čoudy", slug: "coudy" },
    { id: "3", title: "Neon Skyline", slug: "neon" },
  ];
  it("keeps the given order and matches without diacritics or case", () => {
    expect(filterSongs(songs, "")).toEqual(songs);
    expect(filterSongs(songs, "coud").map((s) => s.id)).toEqual(["2"]);
    expect(filterSongs(songs, "CESTA").map((s) => s.id)).toEqual(["1"]);
    expect(filterSongs(songs, "  ")).toEqual(songs);
    expect(filterSongs(songs, "zzz")).toEqual([]);
  });
});

describe("pickerGroups", () => {
  const songs = [
    { id: "a", title: "Aardvark", slug: "aardvark" },
    { id: "c", title: "Čoudy", slug: "coudy" },
    { id: "z", title: "Zebra", slug: "zebra" },
  ];
  it("puts the recently played first, most recent on top, then every song", () => {
    expect(pickerGroups(songs, ["z", "c"], "")).toEqual([
      { kind: "recent", songs: [songs[2], songs[1]] },
      { kind: "all", songs },
    ]);
  });
  it("has no recent group when nothing has been played, and skips ids it does not list", () => {
    expect(pickerGroups(songs, [], "")).toEqual([{ kind: "all", songs }]);
    expect(pickerGroups(songs, ["gone"], "")).toEqual([{ kind: "all", songs }]);
  });
  it("turns a search into one flat list of matches, even an empty one", () => {
    expect(pickerGroups(songs, ["z"], "coud")).toEqual([{ kind: "matches", songs: [songs[1]] }]);
    expect(pickerGroups(songs, ["z"], "zzz")).toEqual([{ kind: "matches", songs: [] }]);
  });
  it("has nothing to group in an empty library", () => {
    expect(pickerGroups([], [], "")).toEqual([]);
  });
});

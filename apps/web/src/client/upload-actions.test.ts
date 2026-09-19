import { describe, expect, it } from "vitest";
import {
  type UploadItem,
  blockedReason,
  canStart,
  defaultKind,
  isSettled,
  makeItem,
  needsDecision,
  readAudioShape,
  reduceItem,
} from "./upload-actions.js";

describe("readAudioShape", () => {
  it("reads the format off the extension and the tier off the format", () => {
    expect(readAudioShape("mix.flac", "")).toEqual({ format: "flac", tier: "lossless" });
    expect(readAudioShape("mix.wav", "")).toEqual({ format: "wav", tier: "lossless" });
    expect(readAudioShape("mix.mp3", "")).toEqual({ format: "mp3", tier: "lossy" });
    expect(readAudioShape("mix.opus", "")).toEqual({ format: "opus", tier: "lossy" });
  });

  it("prefers the extension over the MIME type", () => {
    // The classic case: a .flac off a Linux box or an SMB share arrives with
    // an empty or generic type, and the extension is what the person who
    // rendered it actually chose.
    expect(readAudioShape("mix.flac", "application/octet-stream")).toEqual({
      format: "flac",
      tier: "lossless",
    });
  });

  it("falls back to the MIME type when there is no usable extension", () => {
    expect(readAudioShape("recording", "audio/mpeg")).toEqual({ format: "mp3", tier: "lossy" });
    expect(readAudioShape("bounce", "audio/x-wav")).toEqual({ format: "wav", tier: "lossless" });
  });

  it("treats .ogg as opus — both land on audio/ogg in the bucket", () => {
    expect(readAudioShape("mix.ogg", "")).toEqual({ format: "opus", tier: "lossy" });
  });

  it("is case-insensitive about both", () => {
    expect(readAudioShape("MIX.FLAC", "AUDIO/FLAC")).toEqual({
      format: "flac",
      tier: "lossless",
    });
  });

  it("rejects anything that isn't audio this app stores", () => {
    expect(readAudioShape("notes.pdf", "application/pdf")).toBeNull();
    expect(readAudioShape("session.rpp", "")).toBeNull();
    expect(readAudioShape("cover.png", "image/png")).toBeNull();
    // Real audio, but not a format the schema has a slot for.
    expect(readAudioShape("mix.aiff", "audio/aiff")).toBeNull();
  });
});

describe("defaultKind", () => {
  it("makes the first file a master and everything after it a stem", () => {
    expect(defaultKind(false)).toBe("master");
    expect(defaultKind(true)).toBe("stem");
  });
});

const shape = { format: "flac", tier: "lossless" } as const;
const item = (over: Partial<UploadItem> = {}): UploadItem => ({
  ...makeItem("1", "bass.flac", 1000, shape, "stem"),
  ...over,
});

describe("canStart / blockedReason", () => {
  it("won't start a stem with no instrument, and says why", () => {
    const waiting = item({ instrumentId: null });
    expect(canStart(waiting)).toBe(false);
    expect(blockedReason(waiting)).toBe("Choose which instrument this is.");
  });

  it("starts a stem once an instrument is chosen", () => {
    const ready = item({ instrumentId: "bass-id" });
    expect(canStart(ready)).toBe(true);
    expect(blockedReason(ready)).toBeNull();
  });

  it("starts a master with no instrument at all", () => {
    expect(canStart(item({ kind: "master", instrumentId: null }))).toBe(true);
  });

  it("can restart from a failure or a taken slot, but not mid-flight", () => {
    expect(canStart(item({ kind: "master", phase: "failed" }))).toBe(true);
    expect(canStart(item({ kind: "master", phase: "slot-occupied" }))).toBe(true);
    expect(canStart(item({ kind: "master", phase: "uploading" }))).toBe(false);
    expect(canStart(item({ kind: "master", phase: "ready" }))).toBe(false);
  });
});

describe("needsDecision / isSettled", () => {
  it("is settled when everything is done or waiting on a person", () => {
    expect(isSettled([item({ phase: "ready" }), item({ phase: "failed" })])).toBe(true);
    expect(isSettled([item({ phase: "ready" }), item({ phase: "uploading" })])).toBe(false);
    expect(isSettled([])).toBe(true);
  });

  it("counts the two states that need someone", () => {
    expect(needsDecision(item({ phase: "slot-occupied" }))).toBe(true);
    expect(needsDecision(item({ phase: "failed" }))).toBe(true);
    expect(needsDecision(item({ phase: "uploading" }))).toBe(false);
  });
});

describe("reduceItem", () => {
  it("walks the happy path", () => {
    let x = item({ instrumentId: "bass-id" });
    x = reduceItem(x, { type: "measured", durationMs: 214_000 });
    expect(x).toMatchObject({ phase: "declaring", durationMs: 214_000 });

    x = reduceItem(x, { type: "declared", assetId: "a1" });
    expect(x).toMatchObject({ phase: "uploading", assetId: "a1", progress: 0 });

    x = reduceItem(x, { type: "progress", progress: 64 });
    expect(x.progress).toBe(64);

    x = reduceItem(x, { type: "verifying" });
    expect(x).toMatchObject({ phase: "verifying", progress: 100 });

    x = reduceItem(x, { type: "ready" });
    expect(x).toMatchObject({ phase: "ready", progress: 100 });
  });

  it("carries what is already in the slot, for the replace prompt", () => {
    const occupied = reduceItem(item(), {
      type: "occupied",
      existing: { format: "mp3", tier: "lossy", bytes: 4200 },
    });
    expect(occupied.phase).toBe("slot-occupied");
    expect(occupied.occupiedBy).toEqual({ format: "mp3", tier: "lossy", bytes: 4200 });
  });

  it("clears the message and the occupancy on a retry", () => {
    // A row still saying "already there" while re-uploading would be lying.
    const stuck = reduceItem(
      reduceItem(item(), {
        type: "occupied",
        existing: { format: "mp3", tier: "lossy", bytes: 1 },
      }),
      { type: "retry" },
    );
    expect(stuck).toMatchObject({ phase: "queued", progress: 0, message: null, occupiedBy: null });
  });

  it("drops the instrument when a stem is switched to master", () => {
    // A master carrying an instrument is a 422 from the server; better not to
    // be able to build one.
    const switched = reduceItem(item({ instrumentId: "bass-id" }), {
      type: "kind",
      kind: "master",
    });
    expect(switched).toMatchObject({ kind: "master", instrumentId: null });
  });

  it("keeps the instrument when staying a stem", () => {
    const same = reduceItem(item({ instrumentId: "bass-id" }), { type: "kind", kind: "stem" });
    expect(same.instrumentId).toBe("bass-id");
  });

  it("keeps the failure message so the row can show it", () => {
    const failed = reduceItem(item(), { type: "failed", message: "The upload stopped." });
    expect(failed).toMatchObject({ phase: "failed", message: "The upload stopped." });
  });
});

describe("recorded formats", () => {
  it("reads a phone recording as a lossy webm or m4a", () => {
    expect(readAudioShape("idea.webm", "")).toEqual({ format: "webm", tier: "lossy" });
    expect(readAudioShape("idea.m4a", "")).toEqual({ format: "m4a", tier: "lossy" });
    expect(readAudioShape("blob", "audio/webm")).toEqual({ format: "webm", tier: "lossy" });
    expect(readAudioShape("blob", "audio/mp4")).toEqual({ format: "m4a", tier: "lossy" });
    expect(readAudioShape("voice.m4a", "audio/x-m4a")).toEqual({ format: "m4a", tier: "lossy" });
  });
});

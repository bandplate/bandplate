import { describe, expect, it } from "vitest";
import { masterStorageKey, peaksStorageKey, stemStorageKey } from "./storage-keys.js";

describe("storage key layout", () => {
  it("builds a deterministic master key from takeId, tier and format", () => {
    expect(masterStorageKey("take-1", "lossy", "mp3")).toBe("takes/take-1/master/lossy.mp3");
    expect(masterStorageKey("take-1", "lossless", "flac")).toBe(
      "takes/take-1/master/lossless.flac",
    );
  });

  it("builds a deterministic stem key from takeId, instrument slug, tier and format", () => {
    expect(stemStorageKey("take-1", "bass", "lossy", "mp3")).toBe(
      "takes/take-1/stems/bass/lossy.mp3",
    );
  });

  it("builds a peaks key per audio asset — the master, and each stem's own", () => {
    expect(peaksStorageKey("take-1")).toBe("takes/take-1/peaks/master.json");
    expect(peaksStorageKey("take-1", "bass")).toBe("takes/take-1/peaks/stems/bass.json");
    // The point of the change: two sources on one take no longer collide on
    // a single file, which is what let a solo show the master's shape.
    expect(peaksStorageKey("take-1", "bass")).not.toBe(peaksStorageKey("take-1", "drums"));
  });

  it("the same inputs always produce the same key — a retried upload overwrites, not orphans", () => {
    const a = masterStorageKey("take-42", "lossy", "mp3");
    const b = masterStorageKey("take-42", "lossy", "mp3");
    expect(a).toBe(b);
  });

  it("different tiers produce different keys for the same take", () => {
    expect(masterStorageKey("take-1", "lossy", "mp3")).not.toBe(
      masterStorageKey("take-1", "lossless", "mp3"),
    );
  });
});

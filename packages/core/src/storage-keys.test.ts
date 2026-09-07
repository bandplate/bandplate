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

  it("builds a deterministic peaks key from takeId alone", () => {
    expect(peaksStorageKey("take-1")).toBe("takes/take-1/peaks.json");
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

import { describe, expect, it } from "vitest";
import {
  type PendingSummary,
  afterFailure,
  classifyFailure,
  newPendingItem,
  nextSyncStep,
  pendingToRender,
  retryItem,
  shouldSync,
  summarize,
} from "./stash-sync-logic.js";

const blob = new Blob([new Uint8Array(12)], { type: "audio/webm" });

function item(over: Partial<PendingSummary> = {}): PendingSummary {
  return {
    ...summarize(
      newPendingItem({
        localId: "l-1",
        songId: "s-1",
        songTitle: "Čoudy",
        label: null,
        recordedAt: 1_000,
        durationMs: 42_000,
        mime: "audio/webm;codecs=opus",
        format: "webm",
        blob,
      }),
    ),
    ...over,
  };
}

describe("a new pending recording", () => {
  it("waits, has no take yet, and knows its own size", () => {
    const fresh = newPendingItem({
      localId: "l-1",
      songId: "s-1",
      songTitle: "Čoudy",
      label: "bridge",
      recordedAt: 1_000,
      durationMs: 42_000,
      mime: "audio/webm;codecs=opus",
      format: "webm",
      blob,
    });
    expect(fresh).toMatchObject({
      status: "waiting",
      takeId: null,
      attempts: 0,
      lastError: null,
      bytes: 12,
    });
    expect("blob" in summarize(fresh)).toBe(false);
  });
});

describe("nextSyncStep", () => {
  it("creates the take first, then uploads into it", () => {
    expect(nextSyncStep({ takeId: null })).toBe("create");
    expect(nextSyncStep({ takeId: "t-1" })).toBe("upload");
  });
});

describe("shouldSync", () => {
  it("retries anything not given up on, including one a closed tab left mid-sync", () => {
    expect(shouldSync({ status: "waiting" })).toBe(true);
    expect(shouldSync({ status: "syncing" })).toBe(true);
    expect(shouldSync({ status: "failed" })).toBe(false);
  });
});

describe("classifyFailure", () => {
  it("keeps retrying whatever a better moment would fix", () => {
    expect(classifyFailure({ network: true })).toBe("retry");
    for (const status of [401, 403, 408, 425, 429, 500, 502, 503]) {
      expect(classifyFailure({ status })).toBe("retry");
    }
  });
  it("gives up on what the server will keep refusing", () => {
    for (const status of [400, 404, 409, 413, 422]) {
      expect(classifyFailure({ status })).toBe("give-up");
    }
  });
});

describe("afterFailure and retryItem", () => {
  it("counts the attempt and either waits for the next chance or stops", () => {
    expect(afterFailure(item(), "retry", "offline")).toMatchObject({
      status: "waiting",
      attempts: 1,
      lastError: "offline",
    });
    expect(afterFailure(item({ attempts: 2 }), "give-up", "song gone")).toMatchObject({
      status: "failed",
      attempts: 3,
    });
  });
  it("a manual retry clears the error and queues it again, never losing the take id", () => {
    expect(retryItem(item({ status: "failed", lastError: "x", takeId: "t-1" }))).toMatchObject({
      status: "waiting",
      lastError: null,
      takeId: "t-1",
    });
  });
});

describe("pendingToRender", () => {
  it("shows each recording once: a take the server already lists is its row, not ours", () => {
    const a = item({ localId: "a", recordedAt: 1 });
    const b = item({ localId: "b", recordedAt: 3, takeId: "t-b" });
    const c = item({ localId: "c", recordedAt: 2, takeId: "t-c" });
    expect(pendingToRender([a, b, c], new Set(["t-b"])).map((i) => i.localId)).toEqual(["c", "a"]);
  });
});

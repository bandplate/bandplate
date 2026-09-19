import { describe, expect, it } from "vitest";
import {
  type PendingSummary,
  afterFailure,
  canRetryByHand,
  classifyFailure,
  newPendingItem,
  nextSyncStep,
  pendingForTake,
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

describe("where a failure happened", () => {
  it("is kept on the item, and a manual retry clears it", () => {
    const failed = afterFailure(item({ takeId: "t-1" }), "give-up", "gone", {
      request: "declare",
      status: 404,
    });
    expect(failed.failedAt).toEqual({ request: "declare", status: 404 });
    expect(retryItem(failed).failedAt).toBeNull();
  });
});

describe("canRetryByHand", () => {
  const failed = (request: "create" | "declare" | "put" | "verify", status: number) =>
    item({ status: "failed", failedAt: { request, status } });

  it("offers a retry where the next attempt is a different attempt", () => {
    // The bucket refused this upload (S3 answers a slow socket with 400); the
    // next declare signs a new one.
    expect(canRetryByHand(failed("put", 400))).toBe(true);
    // The file did not arrive whole; uploading it again can fix that.
    expect(canRetryByHand(failed("verify", 409))).toBe(true);
  });

  it("offers none where the server will answer the same way forever", () => {
    // The song was deleted.
    expect(canRetryByHand(failed("create", 404))).toBe(false);
    // The take was deleted, by its owner on another page or another device.
    expect(canRetryByHand(failed("declare", 404))).toBe(false);
    expect(canRetryByHand(failed("verify", 404))).toBe(false);
    expect(canRetryByHand(failed("create", 422))).toBe(false);
    expect(canRetryByHand(failed("declare", 422))).toBe(false);
  });

  it("keeps the old behaviour for a failure saved before the request was recorded", () => {
    // As IndexedDB hands back a record written before `failedAt` existed.
    const { failedAt: _none, ...legacy } = item({ status: "failed" });
    expect(canRetryByHand(legacy)).toBe(true);
  });

  it("has nothing to retry on a recording that has not failed", () => {
    expect(canRetryByHand(item({ status: "waiting" }))).toBe(false);
    expect(canRetryByHand(item({ status: "syncing" }))).toBe(false);
  });
});

describe("a deleted take's local copy", () => {
  it("is found by the take id, and only that one", () => {
    const items = [
      item({ localId: "a", takeId: "t-1" }),
      item({ localId: "b", takeId: "t-2" }),
      item({ localId: "c", takeId: null }),
    ];
    expect(pendingForTake(items, "t-1")).toEqual(["a"]);
    expect(pendingForTake(items, "t-9")).toEqual([]);
  });

  it("is not drawn once its take is known to be deleted", () => {
    const a = item({ localId: "a", takeId: "t-gone" });
    const b = item({ localId: "b", takeId: "t-live", recordedAt: 5 });
    expect(pendingToRender([a, b], new Set(), new Set(["t-gone"])).map((i) => i.localId)).toEqual([
      "b",
    ]);
  });
});

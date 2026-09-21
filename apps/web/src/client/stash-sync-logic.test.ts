import { describe, expect, it } from "vitest";
import {
  afterFailure,
  canRetryByHand,
  classifyFailure,
  localStashRows,
  newPendingItem,
  nextSyncStep,
  ownedBy,
  ownPending,
  type PendingSummary,
  pendingForTake,
  retryItem,
  shouldSync,
  summarize,
  syncedForRender,
} from "./stash-sync-logic.js";

const blob = new Blob([new Uint8Array(12)], { type: "audio/webm" });

function item(over: Partial<PendingSummary> = {}): PendingSummary {
  return {
    ...summarize(
      newPendingItem({
        localId: "l-1",
        memberId: "m-a",
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
      memberId: "m-a",
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
      memberId: "m-a",
    });
    expect("blob" in summarize(fresh)).toBe(false);
  });

  it("keeps a recording that has no song yet", () => {
    // "Zatím bez písně": the queue carries it exactly as it is, and the song
    // is chosen when the recording is added to the band.
    const fresh = newPendingItem({
      localId: "l-2",
      memberId: "m-a",
      songId: null,
      songTitle: null,
      label: "nápad na mezihru",
      recordedAt: 2_000,
      durationMs: 9_000,
      mime: "audio/mp4",
      format: "m4a",
      blob,
    });
    expect(fresh).toMatchObject({ songId: null, songTitle: null, status: "waiting" });
    // Nothing about syncing it is different: it is still a create, then a put.
    expect(nextSyncStep(fresh)).toBe("create");
    expect(shouldSync(fresh)).toBe(true);
    expect(ownedBy(fresh, "m-a")).toBe(true);
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

describe("the rows the stash view's island draws", () => {
  it("shows each recording once: a take the server already lists is its row, not ours", () => {
    const a = item({ localId: "a", recordedAt: 1 });
    const b = item({ localId: "b", recordedAt: 3, takeId: "t-b" });
    const c = item({ localId: "c", recordedAt: 2, takeId: "t-c" });
    expect(
      localStashRows([a, b, c], [], "m-a", new Set(["t-b"])).map((entry) => entry.row.localId),
    ).toEqual(["c", "a"]);
  });

  it("keeps an uploaded recording in place, newest first, with the take it now has", () => {
    const waiting = item({ localId: "a", recordedAt: 1 });
    const done = { ...item({ localId: "b", recordedAt: 3, takeId: "t-b" }), takeId: "t-b" };
    expect(localStashRows([waiting], [done], "m-a", new Set())).toEqual([
      { kind: "synced", row: done },
      { kind: "pending", row: waiting },
    ]);
  });

  it("draws a recording the sync runner has handed over exactly once", () => {
    // The pending store is only re-read at the end of a run, so between the
    // hand-over and that refresh both stores name the same recording.
    const stale = item({ localId: "a", takeId: "t-a" });
    const done = { ...stale, takeId: "t-a" };
    expect(localStashRows([stale], [done], "m-a", new Set())).toEqual([
      { kind: "synced", row: done },
    ]);
  });

  it("stops drawing an uploaded recording once the server's own row is on the page", () => {
    const done = { ...item({ localId: "a", takeId: "t-a" }), takeId: "t-a" };
    expect(localStashRows([], [done], "m-a", new Set(["t-a"]))).toEqual([]);
    expect(localStashRows([], [done], "m-a", new Set(), new Set(["t-a"]))).toEqual([]);
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
    expect(
      localStashRows([a, b], [], "m-a", new Set(), new Set(["t-gone"])).map(
        (entry) => entry.row.localId,
      ),
    ).toEqual(["b"]);
  });
});

describe("a shared browser: each member's own queue", () => {
  it("belongs to the member who recorded it, and to no one else", () => {
    expect(ownedBy(item({ memberId: "m-a" }), "m-a")).toBe(true);
    expect(ownedBy(item({ memberId: "m-a" }), "m-b")).toBe(false);
  });

  it("belongs to no one while nobody is signed in", () => {
    expect(ownedBy(item({ memberId: "m-a" }), null)).toBe(false);
    expect(ownedBy(item({ memberId: "m-a" }), undefined)).toBe(false);
    expect(ownedBy(item({ memberId: "m-a" }), "")).toBe(false);
  });

  it("treats a record saved before members were stored as nobody's", () => {
    // A record from before the field: the key is absent, not null.
    const { memberId: _gone, ...rest } = item();
    const legacy: PendingSummary = rest;
    expect(ownedBy(legacy, "m-a")).toBe(false);
    expect(ownedBy(item({ memberId: null }), "m-a")).toBe(false);
  });

  it("keeps only the signed-in member's recordings, in order", () => {
    const mine1 = item({ localId: "a", memberId: "m-a" });
    const theirs = item({ localId: "b", memberId: "m-b" });
    const legacy = item({ localId: "c", memberId: null });
    const mine2 = item({ localId: "d", memberId: "m-a" });
    expect(ownPending([mine1, theirs, legacy, mine2], "m-a").map((i) => i.localId)).toEqual([
      "a",
      "d",
    ]);
    expect(ownPending([mine1, theirs, legacy, mine2], "m-b").map((i) => i.localId)).toEqual(["b"]);
    expect(ownPending([mine1, theirs, legacy, mine2], null)).toEqual([]);
  });

  it("draws neither another member's recordings nor nobody's", () => {
    const mine = item({ localId: "a", memberId: "m-a", recordedAt: 1 });
    const theirs = item({ localId: "b", memberId: "m-b", recordedAt: 2 });
    const legacy = item({ localId: "c", memberId: null, recordedAt: 3 });
    expect(
      localStashRows([mine, theirs, legacy], [], "m-a", new Set()).map(
        (entry) => entry.row.localId,
      ),
    ).toEqual(["a"]);
    expect(localStashRows([mine, theirs, legacy], [], null, new Set())).toEqual([]);
    // A recording that went up on another member's watch is not this
    // member's row either.
    const theirsDone = { ...theirs, takeId: "t-b" };
    expect(localStashRows([], [theirsDone], "m-a", new Set())).toEqual([]);
  });
});

describe("syncedForRender", () => {
  const handed = (localId: string, pageSeq: number) => ({
    row: { ...item({ localId, takeId: `t-${localId}` }), takeId: `t-${localId}` },
    pageSeq,
  });

  it("keeps the rows handed over on the render that is up", () => {
    expect(syncedForRender([handed("a", 3), handed("b", 3)], 3).map((i) => i.row.localId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("drops a row from an earlier render, whatever became of its take", () => {
    // The bug this is here for: after "Přidat k písni" the take is no longer
    // in the member's stash, so the next render does not list it — and the
    // handed-over row would go on being drawn, with a name that 404s through
    // `/stash/<id>`. The render it belongs to is what decides, not the list.
    expect(syncedForRender([handed("a", 1), handed("b", 2)], 2).map((i) => i.row.localId)).toEqual([
      "b",
    ]);
    expect(syncedForRender([handed("a", 1)], 2)).toEqual([]);
  });

  it("has nothing to say about an empty store", () => {
    expect(syncedForRender([], 7)).toEqual([]);
  });
});

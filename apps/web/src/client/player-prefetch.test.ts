import { describe, expect, it } from "vitest";
import {
  classifyPlayError,
  decideOnEnded,
  decideOnVisible,
  decidePrefetch,
  PREFETCH_LEAD_SECONDS,
  prefetchCandidate,
  prefetchedSource,
  revocable,
  sessionStateOnPause,
} from "./player-prefetch.js";
import type { PlayQueue, QueueItem } from "./player-queue.js";

const item = (n: number, src?: string): QueueItem => ({
  takeId: `take-${n}`,
  assetId: `asset-${n}`,
  title: `Song ${n}`,
  subtitle: `take ${n}`,
  ...(src ? { src } : {}),
});
const queueAt = (index: number, items = [item(1), item(2), item(3)]): PlayQueue => ({
  items,
  index,
});
const key = (n: number) => ({ takeId: `take-${n}`, assetId: `asset-${n}` });

describe("prefetchCandidate", () => {
  it("is the next take in the queue", () => {
    expect(prefetchCandidate(queueAt(0))).toEqual(key(2));
  });
  it("is nothing at the end of the queue, or with no queue", () => {
    expect(prefetchCandidate(queueAt(2))).toBeNull();
    expect(prefetchCandidate(null)).toBeNull();
  });
  it("skips a next take that already plays from this device", () => {
    expect(prefetchCandidate(queueAt(0, [item(1), item(2, "blob:stash")]))).toBeNull();
  });
});

describe("decidePrefetch", () => {
  const base = { queue: queueAt(0), held: null, playing: true, duration: 200 };

  it("waits until the take is within the lead of its end", () => {
    expect(decidePrefetch({ ...base, position: 100 })).toEqual({ discard: false, start: null });
    expect(decidePrefetch({ ...base, position: 200 - PREFETCH_LEAD_SECONDS })).toEqual({
      discard: false,
      start: key(2),
    });
  });
  it("starts at once for a take shorter than the lead", () => {
    expect(decidePrefetch({ ...base, duration: 12, position: 0 }).start).toEqual(key(2));
  });
  it("never starts while paused", () => {
    expect(decidePrefetch({ ...base, playing: false, position: 195 }).start).toBeNull();
  });
  it("with no known duration, starts once the take is under way", () => {
    expect(decidePrefetch({ ...base, duration: Number.NaN, position: 0 }).start).toBeNull();
    expect(decidePrefetch({ ...base, duration: Infinity, position: 0.3 }).start).toEqual(key(2));
    expect(decidePrefetch({ ...base, duration: 0, position: 0.3 }).start).toEqual(key(2));
  });
  it("keeps the one it holds while it is still the next take, even after a seek back", () => {
    expect(decidePrefetch({ ...base, held: key(2), position: 3 })).toEqual({
      discard: false,
      start: null,
    });
    expect(decidePrefetch({ ...base, held: key(2), position: 195 })).toEqual({
      discard: false,
      start: null,
    });
  });
  it("replaces it when the queue moves to a different next take", () => {
    expect(decidePrefetch({ ...base, queue: queueAt(1), held: key(2), position: 195 })).toEqual({
      discard: true,
      start: key(3),
    });
  });
  it("drops it when there is no longer a next take", () => {
    expect(decidePrefetch({ ...base, queue: queueAt(2), held: key(3), position: 195 })).toEqual({
      discard: true,
      start: null,
    });
    expect(decidePrefetch({ ...base, queue: null, held: key(2), position: 195 })).toEqual({
      discard: true,
      start: null,
    });
  });
  it("does not fetch a take the idle element already has in memory", () => {
    expect(decidePrefetch({ ...base, position: 195, inMemory: key(2) }).start).toBeNull();
    expect(decidePrefetch({ ...base, position: 195, inMemory: key(3) }).start).toEqual(key(2));
  });
  it("drops a prefetch for a next take that turned into a local recording", () => {
    const queue = queueAt(0, [item(1), item(2, "blob:stash")]);
    expect(decidePrefetch({ ...base, queue, held: key(2), position: 195 }).discard).toBe(true);
  });
});

describe("prefetchedSource", () => {
  it("uses a finished prefetch of exactly that take", () => {
    expect(prefetchedSource(item(2), { key: key(2), url: "blob:pre" })).toBe("blob:pre");
  });
  it("falls back to the network while the fetch is still in flight", () => {
    expect(prefetchedSource(item(2), { key: key(2), url: null })).toBeUndefined();
  });
  it("never hands one take another take's bytes", () => {
    expect(prefetchedSource(item(3), { key: key(2), url: "blob:pre" })).toBeUndefined();
    expect(
      prefetchedSource(item(2), { key: { takeId: "take-2", assetId: "other" }, url: "blob:pre" }),
    ).toBeUndefined();
  });
  it("a local recording keeps its own URL", () => {
    expect(prefetchedSource(item(2, "blob:stash"), null)).toBe("blob:stash");
  });
  it("is the network with nothing held", () => {
    expect(prefetchedSource(item(2), null)).toBeUndefined();
  });
});

describe("decideOnEnded", () => {
  it("advances while there is a next take, then stops", () => {
    expect(decideOnEnded(queueAt(0))).toEqual({ kind: "advance", index: 1 });
    expect(decideOnEnded(queueAt(2))).toEqual({ kind: "stop" });
    expect(decideOnEnded(null)).toEqual({ kind: "stop" });
  });
});

describe("sessionStateOnPause", () => {
  it("stays playing across the pause the element fires before ended", () => {
    expect(sessionStateOnPause(true, queueAt(0))).toBe("playing");
  });
  it("is paused for a real pause, and at the end of the queue", () => {
    expect(sessionStateOnPause(false, queueAt(0))).toBe("paused");
    expect(sessionStateOnPause(true, queueAt(2))).toBe("paused");
    expect(sessionStateOnPause(true, null)).toBe("paused");
  });
});

describe("classifyPlayError", () => {
  it("reads the DOMException name", () => {
    expect(classifyPlayError({ name: "AbortError" })).toBe("superseded");
    expect(classifyPlayError({ name: "NotAllowedError" })).toBe("refused");
    expect(classifyPlayError({ name: "NotSupportedError" })).toBe("failed");
    expect(classifyPlayError(null)).toBe("failed");
  });
});

describe("decideOnVisible", () => {
  const pending = { index: 1, takeId: "take-2", hidden: true };

  it("resumes the take that should be playing when a hidden advance never started", () => {
    expect(decideOnVisible({ pending, queue: queueAt(1), silent: true })).toEqual({
      kind: "resume",
      index: 1,
    });
  });
  it("leaves playing audio alone", () => {
    expect(decideOnVisible({ pending, queue: queueAt(1), silent: false }).kind).toBe("none");
  });
  it("does nothing without a pending advance, or for one made while visible", () => {
    expect(decideOnVisible({ pending: null, queue: queueAt(1), silent: true }).kind).toBe("none");
    expect(
      decideOnVisible({ pending: { ...pending, hidden: false }, queue: queueAt(1), silent: true })
        .kind,
    ).toBe("none");
  });
  it("does nothing once the queue has moved on or been replaced", () => {
    expect(decideOnVisible({ pending, queue: queueAt(2), silent: true }).kind).toBe("none");
    expect(
      decideOnVisible({ pending, queue: queueAt(1, [item(1), item(9)]), silent: true }).kind,
    ).toBe("none");
    expect(decideOnVisible({ pending, queue: null, silent: true }).kind).toBe("none");
  });
});

describe("revocable", () => {
  it("is every created URL that is neither playing nor held", () => {
    expect(revocable(["blob:a", "blob:b", "blob:c"], ["blob:b", null, undefined])).toEqual([
      "blob:a",
      "blob:c",
    ]);
  });
});

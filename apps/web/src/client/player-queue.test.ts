import { describe, expect, it } from "vitest";
import {
  type QueueItem,
  RESTART_THRESHOLD_SECONDS,
  decidePrevious,
  hasNext,
  nextIndex,
  queueFrom,
  queuePosition,
  sheetHasContent,
} from "./player-queue.js";

const item = (n: number): QueueItem => ({
  takeId: `take-${n}`,
  assetId: `asset-${n}`,
  title: `Song ${n}`,
  subtitle: `take ${n}`,
});
const three = [item(1), item(2), item(3)];

describe("queueFrom", () => {
  it("starts at the clicked take and keeps the whole list", () => {
    expect(queueFrom(three, "take-2")).toEqual({ items: three, index: 1 });
  });
  it("a take that is not in the list becomes a queue of one", () => {
    const lone = item(9);
    expect(queueFrom([lone], "take-9")).toEqual({ items: [lone], index: 0 });
    expect(queueFrom(three, "take-9").index).toBe(0);
  });
  it("drops a repeated take so next never replays it", () => {
    expect(queueFrom([item(1), item(1), item(2)], "take-1").items).toEqual([item(1), item(2)]);
  });
});

describe("next", () => {
  it("moves on until the last take, then there is no next", () => {
    expect(nextIndex(queueFrom(three, "take-1"))).toBe(1);
    expect(hasNext(queueFrom(three, "take-2"))).toBe(true);
    expect(hasNext(queueFrom(three, "take-3"))).toBe(false);
    expect(nextIndex(queueFrom(three, "take-3"))).toBeNull();
    expect(hasNext(null)).toBe(false);
  });
});

describe("decidePrevious", () => {
  it("restarts when past the threshold, like every player people know", () => {
    expect(decidePrevious(queueFrom(three, "take-2"), RESTART_THRESHOLD_SECONDS + 0.1)).toEqual({
      kind: "restart",
    });
  });
  it("goes back one take near the start", () => {
    expect(decidePrevious(queueFrom(three, "take-2"), 1)).toEqual({ kind: "go", index: 0 });
  });
  it("restarts on the first take and on a queue of one", () => {
    expect(decidePrevious(queueFrom(three, "take-1"), 0)).toEqual({ kind: "restart" });
    expect(decidePrevious(queueFrom([item(1)], "take-1"), 0)).toEqual({ kind: "restart" });
    expect(decidePrevious(null, 0)).toEqual({ kind: "restart" });
  });
});

describe("queuePosition", () => {
  it("is 1-based, and absent for a queue of one", () => {
    expect(queuePosition(queueFrom(three, "take-2"))).toEqual({ current: 2, total: 3 });
    expect(queuePosition(queueFrom([item(1)], "take-1"))).toBeNull();
    expect(queuePosition(null)).toBeNull();
  });
});

describe("sheetHasContent", () => {
  it("is empty only with one source, no mixer and nothing queued", () => {
    expect(
      sheetHasContent({ sourceCount: 1, stemCount: 0, queueLength: 1, minMixerStems: 2 }),
    ).toBe(false);
    expect(
      sheetHasContent({ sourceCount: 2, stemCount: 1, queueLength: 1, minMixerStems: 2 }),
    ).toBe(true);
    expect(
      sheetHasContent({ sourceCount: 1, stemCount: 0, queueLength: 2, minMixerStems: 2 }),
    ).toBe(true);
  });
});

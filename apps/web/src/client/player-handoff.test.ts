import { describe, expect, it } from "vitest";
import {
  acceptsEvent,
  decideHandoff,
  decideIdle,
  heldSources,
  holdsItem,
  inMemory,
  type Loaded,
  otherSlot,
  sourceFor,
  usableLoad,
} from "./player-handoff.js";
import { PREFETCH_LEAD_SECONDS } from "./player-prefetch.js";
import type { PlayQueue, QueueItem } from "./player-queue.js";
import { audioUrl } from "./player-store.js";

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
const loaded = (n: number, src = audioUrl(`asset-${n}`)): Loaded => ({ ...key(n), src });

describe("slots", () => {
  it("take turns", () => {
    expect(otherSlot(0)).toBe(1);
    expect(otherSlot(1)).toBe(0);
  });
  it("only the active element's events count", () => {
    expect(acceptsEvent(0, 0)).toBe(true);
    expect(acceptsEvent(1, 0)).toBe(false);
    expect(acceptsEvent(0, 1)).toBe(false);
  });
});

describe("holdsItem", () => {
  it("is the same take on the same asset", () => {
    expect(holdsItem(loaded(2), item(2))).toBe(true);
    expect(holdsItem(loaded(2, "blob:pre"), item(2))).toBe(true);
    expect(holdsItem(loaded(3), item(2))).toBe(false);
    expect(holdsItem({ ...loaded(2), assetId: "stem" }, item(2))).toBe(false);
    expect(holdsItem(null, item(2))).toBe(false);
  });
  it("a recording on this device only counts with its own URL", () => {
    expect(holdsItem(loaded(2, "blob:stash"), item(2, "blob:stash"))).toBe(true);
    expect(holdsItem(loaded(2, "blob:old"), item(2, "blob:stash"))).toBe(false);
  });
});

describe("sourceFor", () => {
  it("is the row's own URL, then the prefetch, then the network", () => {
    expect(sourceFor(item(2, "blob:stash"), null)).toBe("blob:stash");
    expect(sourceFor(item(2), { key: key(2), url: "blob:pre" })).toBe("blob:pre");
    expect(sourceFor(item(2), { key: key(2), url: null })).toBe(audioUrl("asset-2"));
    expect(sourceFor(item(2), null)).toBe(audioUrl("asset-2"));
  });
});

describe("decideIdle", () => {
  const due = { playing: true, duration: 200, position: 200 - PREFETCH_LEAD_SECONDS };
  const early = { playing: true, duration: 200, position: 10 };
  const base = { queue: queueAt(0), idle: null, settled: true, prefetch: null };

  it("leaves the element just handed off from alone until the new one plays", () => {
    expect(decideIdle({ ...base, ...due, idle: loaded(1), settled: false })).toEqual({
      kind: "keep",
    });
    expect(decideIdle({ ...base, ...due, idle: null, settled: false })).toEqual({ kind: "keep" });
  });
  it("loads nothing before the prefetch window opens", () => {
    expect(decideIdle({ ...base, ...early })).toEqual({ kind: "keep" });
    expect(decideIdle({ ...base, ...due, playing: false })).toEqual({ kind: "keep" });
  });
  it("lets go of an old take once settled, window open or not", () => {
    expect(decideIdle({ ...base, ...early, idle: loaded(1) })).toEqual({ kind: "clear" });
  });
  it("loads the next take from the prefetched bytes", () => {
    expect(decideIdle({ ...base, ...due, prefetch: { key: key(2), url: "blob:pre" } })).toEqual({
      kind: "load",
      item: item(2),
      src: "blob:pre",
    });
  });
  it("waits for a prefetch still in flight instead of downloading twice", () => {
    expect(decideIdle({ ...base, ...due, prefetch: { key: key(2), url: null } })).toEqual({
      kind: "keep",
    });
    expect(
      decideIdle({ ...base, ...due, idle: loaded(1), prefetch: { key: key(2), url: null } }),
    ).toEqual({ kind: "clear" });
  });
  it("goes to the network when the prefetch failed or none is for this take", () => {
    const network = { kind: "load", item: item(2), src: audioUrl("asset-2") };
    expect(
      decideIdle({ ...base, ...due, prefetch: { key: key(2), url: null, failed: true } }),
    ).toEqual(network);
    expect(decideIdle({ ...base, ...due })).toEqual(network);
    expect(decideIdle({ ...base, ...due, prefetch: { key: key(3), url: "blob:x" } })).toEqual(
      network,
    );
  });
  it("a recording on this device loads from its own URL", () => {
    const queue = queueAt(0, [item(1), item(2, "blob:stash")]);
    expect(decideIdle({ ...base, ...due, queue })).toEqual({
      kind: "load",
      item: item(2, "blob:stash"),
      src: "blob:stash",
    });
  });
  it("keeps the next take once it holds it, even after a seek back", () => {
    const prefetch = { key: key(2), url: "blob:pre" };
    expect(decideIdle({ ...base, ...early, idle: loaded(2, "blob:pre"), prefetch })).toEqual({
      kind: "keep",
    });
    expect(decideIdle({ ...base, ...due, idle: loaded(2) })).toEqual({ kind: "keep" });
  });
  it("moves a next take loaded from the network onto the bytes when they arrive", () => {
    expect(
      decideIdle({ ...base, ...due, idle: loaded(2), prefetch: { key: key(2), url: "blob:pre" } }),
    ).toEqual({ kind: "load", item: item(2), src: "blob:pre" });
  });
  it("keeps bytes already in memory rather than swap them for a second copy", () => {
    expect(
      decideIdle({
        ...base,
        ...due,
        idle: loaded(2, "blob:first"),
        prefetch: { key: key(2), url: "blob:second" },
      }),
    ).toEqual({ kind: "keep" });
  });
  it("follows the queue when it changes under a loaded element", () => {
    expect(
      decideIdle({
        ...base,
        ...due,
        queue: queueAt(1),
        idle: loaded(2),
        prefetch: { key: key(3), url: "blob:3" },
      }),
    ).toEqual({ kind: "load", item: item(3), src: "blob:3" });
  });
  it("lets go at the end of the queue, and with no queue", () => {
    expect(decideIdle({ ...base, ...due, queue: queueAt(2), idle: loaded(3) })).toEqual({
      kind: "clear",
    });
    expect(decideIdle({ ...base, ...due, queue: null, idle: loaded(2) })).toEqual({
      kind: "clear",
    });
    expect(decideIdle({ ...base, ...due, queue: null })).toEqual({ kind: "keep" });
  });
});

describe("decideHandoff", () => {
  it("plays what the idle element already holds, from where it is", () => {
    expect(
      decideHandoff({
        idle: loaded(2, "blob:pre"),
        idlePosition: 0,
        item: item(2),
        prefetch: { key: key(2), url: "blob:pre" },
      }),
    ).toEqual({ load: null, rewind: false });
    expect(
      decideHandoff({ idle: loaded(2), idlePosition: 0, item: item(2), prefetch: null }),
    ).toEqual({ load: null, rewind: false });
  });
  it("rewinds an element that played this take before (Previous hands back to it)", () => {
    expect(
      decideHandoff({ idle: loaded(1), idlePosition: 42, item: item(1), prefetch: null }),
    ).toEqual({ load: null, rewind: true });
  });
  it("loads the idle element first when it holds something else, or nothing", () => {
    expect(
      decideHandoff({ idle: loaded(3), idlePosition: 0, item: item(2), prefetch: null }),
    ).toEqual({ load: audioUrl("asset-2"), rewind: false });
    expect(
      decideHandoff({
        idle: null,
        idlePosition: 0,
        item: item(2),
        prefetch: { key: key(2), url: "blob:pre" },
      }),
    ).toEqual({ load: "blob:pre", rewind: false });
    expect(
      decideHandoff({ idle: null, idlePosition: 0, item: item(2, "blob:stash"), prefetch: null }),
    ).toEqual({ load: "blob:stash", rewind: false });
  });
  it("prefers the bytes in memory over a network load of the same take", () => {
    expect(
      decideHandoff({
        idle: loaded(2),
        idlePosition: 0,
        item: item(2),
        prefetch: { key: key(2), url: "blob:pre" },
      }),
    ).toEqual({ load: "blob:pre", rewind: false });
  });
  it("keeps bytes it already has in memory", () => {
    expect(
      decideHandoff({
        idle: loaded(2, "blob:first"),
        idlePosition: 0,
        item: item(2),
        prefetch: { key: key(2), url: "blob:second" },
      }),
    ).toEqual({ load: null, rewind: false });
  });
});

describe("inMemory", () => {
  it("is the take an element holds from memory, not one on the network", () => {
    expect(inMemory(loaded(2, "blob:pre"))).toEqual(key(2));
    expect(inMemory(loaded(2))).toBeNull();
    expect(inMemory(null)).toBeNull();
  });
});

describe("heldSources", () => {
  it("is every src on either element", () => {
    expect(heldSources([loaded(1, "blob:a"), null])).toEqual(["blob:a"]);
    expect(heldSources([loaded(1, "blob:a"), loaded(2, "blob:b")])).toEqual(["blob:a", "blob:b"]);
  });
});

describe("usableLoad", () => {
  const loaded: Loaded = { takeId: "take-2", assetId: "asset-2", src: audioUrl("asset-2") };

  it("keeps what a healthy element holds", () => {
    expect(usableLoad(loaded, false)).toBe(loaded);
  });

  it("counts an element whose load failed as holding nothing, so the handoff loads it again", () => {
    expect(usableLoad(loaded, true)).toBeNull();
    expect(
      decideHandoff({
        idle: usableLoad(loaded, true),
        idlePosition: 0,
        item: item(2),
        prefetch: null,
      }).load,
    ).toBe(audioUrl("asset-2"));
  });
});

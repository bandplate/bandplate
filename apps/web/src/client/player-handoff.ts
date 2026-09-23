// Two `<audio>` elements taking turns, so a queue moves on without the
// playing element ever changing its `src`.
//
// Why: Chrome on Android ties the lock-screen media notification to the media
// player behind ONE element. `audio.src = …` tears that player down, the
// notification goes with it, and a player that starts afterwards in the
// background does not get it back (on some phones the backgrounded page is
// frozen at that moment instead). Prefetching the bytes (see
// `player-prefetch.ts`) made the switch fast, but it was still a switch.
//
// So the player has two elements. One is ACTIVE: everything the bar shows and
// every control acts on it. The other is IDLE, loaded ahead of time with the
// next take once the prefetch window opens. Every track change (the queue
// advancing on `ended`, Next, Previous, the Hraje sheet's order list, a tap on
// another take) plays the idle element and swaps the roles; the element that
// was playing is paused or has ended and keeps its source. It is reused, as
// the new idle element, only once the new one is actually playing.
//
// The queue does not wait for `ended`, either. Tested on the phones that lost
// the notification: a handoff at `ended`, or a `src` change on one element
// before it ends, both leave a moment with nothing playing, and Chrome takes
// the notification away in that moment. Only starting the next element while
// the current one still plays kept it (the /lab/next-track.html test, variant
// C). So the advance is made `OVERLAP_LEAD_SECONDS` before the end
// (`decideEarlyAdvance`), and the element handed off from is paused once the
// new one is playing. `ended` stays as the fallback for a take too short to
// have a lead, or a `timeupdate` that never came in time.
//
// Manual moves go through the same handoff rather than a `src` change on the
// active element. A gesture in the page would survive the `src` change, but
// the lock screen's own Next/Previous are manual moves with the page in the
// background, which is exactly the case the notification does not survive.
// One path for every track change is also one path to get right.
//
// A source switch on the same take (master to a stem, from the sheet) still
// changes `src` on the active element: it can only be made from the open sheet,
// in the foreground, and has to keep the playhead where it was.
//
// Everything decidable is here, pure, with a node test beside it. `Player.tsx`
// owns the elements and does what these return.
import { type HeldPrefetch, prefetchDue, prefetchedSource } from "./player-prefetch.js";
import type { PlayQueue, QueueItem } from "./player-queue.js";
import { nextIndex } from "./player-queue.js";
import { audioUrl } from "./player-store.js";

/** Which of the two elements. */
export type Slot = 0 | 1;

export function otherSlot(slot: Slot): Slot {
  return slot === 0 ? 1 : 0;
}

/**
 * Whether an event from element `from` is the player's business. Only the
 * active element's are: the idle one loading the next take fires
 * `durationchange`, `loadedmetadata` and friends of its own, and the one just
 * handed off from fires `pause`. Neither may move the playhead, the duration,
 * the play button or the queue.
 */
export function acceptsEvent(from: Slot, active: Slot): boolean {
  return from === active;
}

/** What one element has been given: the take, the asset, and the exact `src`. */
export interface Loaded {
  takeId: string;
  assetId: string;
  src: string;
}

/** Whether an element already holds this queue item (the take on its master, and for a recording still on this device, its own URL). */
export function holdsItem(loaded: Loaded | null, item: QueueItem): boolean {
  if (!loaded || loaded.takeId !== item.takeId || loaded.assetId !== item.assetId) {
    return false;
  }
  return item.src === undefined || loaded.src === item.src;
}

/**
 * What an element really holds: nothing once its load has failed. `Loaded`
 * records the `src` it was given, not whether that worked, and an idle
 * element whose load died on a network blip would otherwise count as holding
 * the next take forever: never reloaded, and played dead at the handoff.
 */
export function usableLoad(loaded: Loaded | null, errored: boolean): Loaded | null {
  return errored ? null : loaded;
}

/** Whether an element is loading its take over the network (the asset route) rather than from bytes in memory. */
function overNetwork(loaded: Loaded): boolean {
  return loaded.src === audioUrl(loaded.assetId);
}

/**
 * The take an element holds from memory (a prefetch, or a recording's own
 * URL), for `decidePrefetch`: nothing to fetch for it again.
 */
export function inMemory(loaded: Loaded | null): { takeId: string; assetId: string } | null {
  return loaded && !overNetwork(loaded) ? { takeId: loaded.takeId, assetId: loaded.assetId } : null;
}

/**
 * Whether an element holding `item` should be given `own` instead: only an
 * element still on the network moves onto bytes in memory. One already in
 * memory keeps what it has, even if a second copy has since been fetched.
 */
function worthReloading(loaded: Loaded, own: string | undefined): own is string {
  return own !== undefined && own !== loaded.src && overNetwork(loaded);
}

/** Where a queue item plays from: its own URL, a finished prefetch of it, else the asset route. */
export function sourceFor(item: QueueItem, prefetch: HeldPrefetch | null): string {
  return prefetchedSource(item, prefetch) ?? audioUrl(item.assetId);
}

export type IdleAction =
  | { kind: "keep" }
  /** Let go of what it holds (an old take, and the object URL with it). */
  | { kind: "clear" }
  | { kind: "load"; item: QueueItem; src: string };

export interface IdleInput {
  queue: PlayQueue | null;
  /** What the idle element holds. */
  idle: Loaded | null;
  /**
   * Whether the active element has played since the last handoff. Until it
   * has, the idle element is the one that was playing a moment ago and is
   * left exactly as it is.
   */
  settled: boolean;
  prefetch: HeldPrefetch | null;
  /** The ACTIVE element's state. */
  playing: boolean;
  position: number;
  duration: number;
}

/**
 * What the idle element should hold right now. Its target is the queue's next
 * item. It is loaded once the prefetch window opens (`prefetchDue`), from the
 * prefetched bytes when they are in, and from the network only when no
 * prefetch is coming (a failed one, or none for this take): a prefetch still
 * in flight is waited for rather than downloading the take twice. A target
 * loaded from the network is moved onto the bytes once they arrive. Anything
 * else it holds is let go.
 */
export function decideIdle(input: IdleInput): IdleAction {
  const { idle, prefetch } = input;
  if (!input.settled) {
    return { kind: "keep" };
  }
  const index = nextIndex(input.queue);
  const target = index === null ? undefined : input.queue?.items[index];
  const letGo: IdleAction = idle ? { kind: "clear" } : { kind: "keep" };
  if (!target) {
    return letGo;
  }
  const own = prefetchedSource(target, prefetch);
  if (idle && holdsItem(idle, target)) {
    return worthReloading(idle, own) ? { kind: "load", item: target, src: own } : { kind: "keep" };
  }
  if (!prefetchDue(input)) {
    return letGo;
  }
  if (own !== undefined) {
    return { kind: "load", item: target, src: own };
  }
  const inFlight =
    prefetch !== null &&
    prefetch.key.takeId === target.takeId &&
    prefetch.key.assetId === target.assetId &&
    !prefetch.failed;
  if (inFlight) {
    return letGo;
  }
  return { kind: "load", item: target, src: audioUrl(target.assetId) };
}

/**
 * How to get the idle element ready to take over with `item`: `load` is the
 * `src` to give it first (`null` when it already holds the item), `rewind`
 * whether it must go back to 0:00 (an element that played this take before,
 * which Previous hands back to).
 */
export function decideHandoff(input: {
  idle: Loaded | null;
  idlePosition: number;
  item: QueueItem;
  prefetch: HeldPrefetch | null;
}): { load: string | null; rewind: boolean } {
  const { idle, item } = input;
  const own = prefetchedSource(item, input.prefetch);
  if (idle && holdsItem(idle, item) && !worthReloading(idle, own)) {
    return { load: null, rewind: input.idlePosition > 0 };
  }
  return { load: sourceFor(item, input.prefetch), rewind: false };
}

/** Every `src` the two elements hold, for `revocable`: an object URL on either is still in use. */
export function heldSources(loaded: readonly (Loaded | null)[]): string[] {
  return loaded.flatMap((it) => (it ? [it.src] : []));
}

/**
 * How long before the end the queue moves on. Long enough that a
 * `timeupdate` (about four a second, less in the background) lands inside it,
 * short enough that the tail cut from the take is its ring-out.
 */
export const OVERLAP_LEAD_SECONDS = 1;

/**
 * The index to move on to now, before the active element ends, or `null` to
 * keep playing. Only while it really plays, with a known length longer than
 * the lead (a take that short just ends), and only where the queue has
 * somewhere to go.
 */
export function decideEarlyAdvance(input: {
  queue: PlayQueue | null;
  position: number;
  duration: number;
  paused: boolean;
}): number | null {
  const { position, duration } = input;
  if (input.paused || !Number.isFinite(duration) || duration <= OVERLAP_LEAD_SECONDS * 2) {
    return null;
  }
  if (duration - position > OVERLAP_LEAD_SECONDS) {
    return null;
  }
  return nextIndex(input.queue);
}

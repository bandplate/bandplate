// Gapless-enough queue advance: the next take's audio, fetched into memory
// while the current one is still playing.
//
// Why it exists: on `ended`, the player used to point `<audio>` at the next
// take's asset route and wait for the network. Silence for that long is all
// some Android phones need. With the screen off, the OS drops the media
// notification the moment nothing is playing, and an aggressive OEM power
// manager then freezes the backgrounded browser, so the next take never
// starts. A Blob already in memory starts within milliseconds, before any of
// that happens.
//
// Everything decidable lives here, pure, with a node test beside it: when to
// start a prefetch, whether one in hand is still worth keeping, which source
// the next take should start from, what `ended` means, and what to do when
// the page comes back after an advance that did not take. `Player.tsx` does
// the fetch, the object URLs and the `<audio>` element, and nothing else.
import type { PlayQueue, QueueItem } from "./player-queue.js";
import { nextIndex } from "./player-queue.js";

/**
 * How close to the end of the current take the next one starts downloading.
 * Long enough for a slow phone connection to fetch a few MB of Opus, short
 * enough that skipping around a long take does not keep fetching takes nobody
 * reaches. A take shorter than this prefetches as soon as it plays.
 */
export const PREFETCH_LEAD_SECONDS = 20;

/** Which take a prefetch is for. The asset is the identity: the bytes are the same whichever queue or index asked for them. */
export interface PrefetchKey {
  takeId: string;
  assetId: string;
}

/** The one prefetch the player holds at a time. `url` is the object URL once the bytes are in, `null` while the fetch is in flight. */
export interface HeldPrefetch {
  key: PrefetchKey;
  url: string | null;
}

function keyOf(item: QueueItem): PrefetchKey {
  return { takeId: item.takeId, assetId: item.assetId };
}

function sameKey(a: PrefetchKey, b: PrefetchKey): boolean {
  return a.takeId === b.takeId && a.assetId === b.assetId;
}

/**
 * The take a prefetch should be for, whatever the clock says: the queue's next
 * item, unless there is none or it already plays from memory (a recording
 * still on this device carries its own object URL, owned by its stash row).
 */
export function prefetchCandidate(queue: PlayQueue | null): PrefetchKey | null {
  const index = nextIndex(queue);
  const item = index === null ? undefined : queue?.items[index];
  if (!item || item.src) {
    return null;
  }
  return keyOf(item);
}

export interface PrefetchInput {
  queue: PlayQueue | null;
  held: PrefetchKey | null;
  /** Whether the `<audio>` element is playing (not paused). */
  playing: boolean;
  /** `audio.currentTime`, seconds. */
  position: number;
  /** `audio.duration`, seconds. `NaN`, `Infinity` or 0 while unknown. */
  duration: number;
}

/**
 * What to do with the prefetch slot right now. `discard` drops (aborts,
 * revokes) what is held; `start` names the take to fetch. Both can be set: a
 * queue change that swaps the next take replaces the held prefetch outright.
 *
 * A held prefetch is kept as long as it is still the next take, whatever the
 * playhead does: seeking back to the start of a long take must not throw away
 * bytes that will be needed at its end. A NEW one only starts while playing
 * and within `PREFETCH_LEAD_SECONDS` of the end. With the duration unknown (a
 * file with no duration header), "near the end" cannot be judged, so it
 * starts as soon as the take is actually under way.
 */
export function decidePrefetch(input: PrefetchInput): {
  discard: boolean;
  start: PrefetchKey | null;
} {
  const candidate = prefetchCandidate(input.queue);
  const keep = input.held !== null && candidate !== null && sameKey(input.held, candidate);
  const discard = input.held !== null && !keep;
  if (keep || !candidate || !input.playing) {
    return { discard, start: null };
  }
  const known = Number.isFinite(input.duration) && input.duration > 0;
  const due = known ? input.duration - input.position <= PREFETCH_LEAD_SECONDS : input.position > 0;
  return { discard, start: due ? candidate : null };
}

/**
 * Where a queue item should play from: its own object URL for a recording
 * still on this device, else a finished prefetch of exactly this take, else
 * `undefined` (the asset route, over the network, as before).
 */
export function prefetchedSource(item: QueueItem, held: HeldPrefetch | null): string | undefined {
  if (item.src) {
    return item.src;
  }
  if (held?.url && sameKey(held.key, keyOf(item))) {
    return held.url;
  }
  return undefined;
}

/** What `ended` means: the ordinary stop at the end of the queue, or on to the next take. */
export type EndedAction = { kind: "stop" } | { kind: "advance"; index: number };

export function decideOnEnded(queue: PlayQueue | null): EndedAction {
  const index = nextIndex(queue);
  return index === null ? { kind: "stop" } : { kind: "advance", index };
}

/**
 * What the OS media session should say when the element fires `pause`. The
 * element pauses itself just before `ended`, and on a queue with somewhere to
 * go that is not a pause at all: telling the OS "paused" for the few
 * milliseconds of the switch is what lets it take the notification away.
 */
export function sessionStateOnPause(ended: boolean, queue: PlayQueue | null): "playing" | "paused" {
  return ended && nextIndex(queue) !== null ? "playing" : "paused";
}

/** How a `play()` promise that rejected should be read. */
export type PlayFailure = "superseded" | "refused" | "failed";

/**
 * `AbortError`: a newer `src` replaced this one, which is not a failure.
 * `NotAllowedError`: the browser will not start audio without a gesture,
 * which is expected on a page that was frozen in the background. Anything
 * else is the source itself not playing.
 */
export function classifyPlayError(error: unknown): PlayFailure {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "AbortError") return "superseded";
  if (name === "NotAllowedError") return "refused";
  return "failed";
}

/** An automatic advance that has not been heard yet. Cleared by the `playing` event, or by anything the user starts. */
export interface PendingAdvance {
  index: number;
  takeId: string;
  /** Whether the page was hidden when the advance happened. A visible page shows the paused bar; nothing to recover. */
  hidden: boolean;
}

export type VisibleAction = { kind: "none" } | { kind: "resume"; index: number };

/**
 * The page is visible again. If an advance made while it was hidden never got
 * going (`play()` refused, the source never loaded, the browser frozen before
 * it could), put the take that should be playing back on the element from
 * 0:00. The caller tries `play()`; if that is refused, the take sits paused
 * with the play button ready. Only when the queue still points at that take
 * and the element is silent: a user who has since picked something else, or
 * audio that did start after all, is left alone.
 */
export function decideOnVisible(input: {
  pending: PendingAdvance | null;
  queue: PlayQueue | null;
  /** The element is paused, or stuck on a source that errored (which can leave `paused` false). */
  silent: boolean;
}): VisibleAction {
  const { pending, queue } = input;
  if (!pending?.hidden || !input.silent || !queue) {
    return { kind: "none" };
  }
  if (queue.index !== pending.index || queue.items[pending.index]?.takeId !== pending.takeId) {
    return { kind: "none" };
  }
  return { kind: "resume", index: pending.index };
}

/**
 * Which of the object URLs this player created can be revoked: every one that
 * is neither on the element nor the prefetch still held. A stash row's own
 * URL is never in `created`, so it is never revoked here.
 */
export function revocable(
  created: readonly string[],
  keep: readonly (string | null | undefined)[],
): string[] {
  return created.filter((url) => !keep.includes(url));
}

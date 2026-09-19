// The play queue: what "next" means. A queue is the list a take was started
// from, snapshotted at the click — the DOM it was read from is gone after the
// next navigation, and the player is not. Pure, so the rules have a test;
// `Player.tsx` only reads the DOM and moves the <audio> element.

export interface QueueItem {
  takeId: string;
  /** The master asset — a queued take always starts on its master. */
  assetId: string;
  title: string;
  subtitle: string;
}

export interface PlayQueue {
  items: QueueItem[];
  index: number;
}

/** Past this, Previous restarts the take instead of going back one. */
export const RESTART_THRESHOLD_SECONDS = 3;

export function queueFrom(items: QueueItem[], startTakeId: string): PlayQueue {
  const seen = new Set<string>();
  const unique = items.filter((it) => {
    if (seen.has(it.takeId)) {
      return false;
    }
    seen.add(it.takeId);
    return true;
  });
  const index = unique.findIndex((it) => it.takeId === startTakeId);
  return { items: unique, index: Math.max(0, index) };
}

export function nextIndex(queue: PlayQueue | null): number | null {
  if (!queue || queue.index + 1 >= queue.items.length) {
    return null;
  }
  return queue.index + 1;
}

export function hasNext(queue: PlayQueue | null): boolean {
  return nextIndex(queue) !== null;
}

export type PreviousAction = { kind: "restart" } | { kind: "go"; index: number };

export function decidePrevious(queue: PlayQueue | null, positionSeconds: number): PreviousAction {
  if (!queue || queue.index === 0 || positionSeconds > RESTART_THRESHOLD_SECONDS) {
    return { kind: "restart" };
  }
  return { kind: "go", index: queue.index - 1 };
}

export function queuePosition(queue: PlayQueue | null): { current: number; total: number } | null {
  if (!queue || queue.items.length < 2) {
    return null;
  }
  return { current: queue.index + 1, total: queue.items.length };
}

/** Whether the Hraje sheet would show anything — if not, the title is plain text, not a button. */
export function sheetHasContent(input: {
  sourceCount: number;
  stemCount: number;
  queueLength: number;
  minMixerStems: number;
}): boolean {
  return input.sourceCount > 1 || input.stemCount >= input.minMixerStems || input.queueLength > 1;
}

/**
 * Whether two queues would play the same takes in the same order from the
 * same place. Re-tapping the current take from a DIFFERENT list is a pause
 * or a resume, never a restart, but Next has to follow the list that was
 * tapped last; this is what tells `Player.tsx` the queue needs replacing.
 * Compared by take and position only: a title re-rendered with a newer
 * label is still the same queue.
 */
export function sameQueue(a: PlayQueue | null, b: PlayQueue | null): boolean {
  if (!a || !b) {
    return a === b;
  }
  return (
    a.index === b.index &&
    a.items.length === b.items.length &&
    a.items.every((it, i) => it.takeId === b.items[i]?.takeId)
  );
}

// What the shell player SHOWS and READS, decided without a DOM.
//
// `player-actions.ts` decides what a click does and `player-queue.ts` what
// "next" means. This is the rest of what `Player.tsx` used to work out inline:
// how a play control's `data-*` attributes become a source, which controls
// belong in a queue, what the bar's subtitle and live region say, and which
// transport buttons the lock screen may offer. `Player.tsx` reads `el.dataset`,
// `document.activeElement` and `navigator.mediaSession`, and hands the values
// here; nothing in this module touches them.
import type { playerMessages } from "@bandplate/i18n";
import { MIN_MIXER_STEMS } from "./mixer-tracks.js";
import type { ClickedSource } from "./player-actions.js";
import {
  canGoPrevious,
  hasNext,
  type PlayQueue,
  type QueueItem,
  queuePosition,
} from "./player-queue.js";
import type { PlayerSource, PlayerTrack } from "./player-store.js";

type PlayerWords = ReturnType<typeof playerMessages>;

/**
 * A play control's `data-*` attributes (`el.dataset`) as the source it plays,
 * or null for a control missing the three it cannot do without.
 */
export function readSourceControl(
  dataset: Readonly<Record<string, string | undefined>>,
): ClickedSource | null {
  const { takeId, assetId, title } = dataset;
  if (!takeId || !assetId || !title) {
    return null;
  }
  return {
    takeId,
    assetId,
    title,
    subtitle: dataset.subtitle ?? "",
    // A control that says nothing about its source is the master: that is
    // what every plain play button on a row or a plate is.
    sourceKind: dataset.sourceKind === "stem" ? "stem" : "master",
    sourceName: dataset.sourceName ?? "",
    role: dataset.role ?? "toggle",
    // `data-audio-src`: an object URL, for a recording the server does not
    // have yet.
    src: dataset.audioSrc,
  };
}

/** A control as the queue item it starts. */
export function queueItemOf(control: ClickedSource): QueueItem {
  return {
    takeId: control.takeId,
    assetId: control.assetId,
    title: control.title,
    subtitle: control.subtitle,
    src: control.src,
  };
}

/**
 * The control as a queue entry, or null when it is not one. Only plain master
 * toggles count, which is every play control a take row has: a queued take
 * starts on its master, and a source pill belongs to the take already loaded.
 */
export function queueableItem(control: ClickedSource): QueueItem | null {
  return control.role === "toggle" && control.sourceKind === "master" ? queueItemOf(control) : null;
}

/**
 * The live region's sentence on a track change. A switch to a stem names the
 * instrument too: from a listener's side that IS a track change.
 */
export function nowPlayingAnnouncement(track: PlayerTrack | null, t: PlayerWords): string {
  if (!track) {
    return "";
  }
  return track.sourceKind === "stem"
    ? t.nowPlayingSource({ title: track.title, source: t.solo(track.sourceName) })
    : t.nowPlaying(track.title);
}

/**
 * The bar's second line: the take's own subtitle, then which source plays
 * (only when there is more than one to choose between), then where it sits in
 * the queue (only in a queue of more than one). Empty parts are left out
 * rather than joined as a stray separator.
 */
export function playerSubtitle({
  track,
  sources,
  queue,
  t,
}: {
  track: PlayerTrack | null;
  sources: PlayerSource[] | null;
  queue: PlayQueue | null;
  t: PlayerWords;
}): string {
  const sourceLabel = !track ? "" : track.sourceKind === "stem" ? track.sourceName : t.master;
  const position = queuePosition(queue);
  return [
    track?.subtitle,
    sources && sources.length > 1 ? sourceLabel : "",
    position ? t.position(position) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function stemCount(sources: PlayerSource[] | null): number {
  return sources?.filter((source) => source.kind === "stem").length ?? 0;
}

/** Whether the Hraje sheet links to the mixer: enough stems, and the list has arrived. */
export function showsMixer(sources: PlayerSource[] | null): boolean {
  return sources !== null && stemCount(sources) >= MIN_MIXER_STEMS;
}

/**
 * Whether moving the queue to `next` disables the skip button that has
 * focus. A focused element that becomes disabled drops focus to `<body>`, so
 * `Player.tsx` hands it to the play button on the same surface first. Asked
 * at a position of 0, because a move always starts the take from the top.
 */
export function controlDropsFocus(next: PlayQueue, focused: "next" | "previous" | null): boolean {
  if (focused === "next") {
    return !hasNext(next);
  }
  if (focused === "previous") {
    return !canGoPrevious(next, 0);
  }
  return false;
}

/**
 * How many bars to draw: what the rail has room for, but never more than the
 * peaks file has values (`downsamplePeaks` would only repeat buckets), and at
 * least one.
 */
export function drawnBarCount(barCount: number, peakCount: number): number {
  return Math.max(1, Math.min(barCount, peakCount));
}

/**
 * Which transport the lock screen and a headset may offer. Previous whenever
 * anything is loaded, since it always does something (go back, or restart);
 * Next only when there is a next. A headset press must not act on a control
 * the bar itself shows as unavailable.
 */
export function remoteTransport(
  track: PlayerTrack | null,
  queue: PlayQueue | null,
): { previous: boolean; next: boolean } {
  return { previous: track !== null, next: track !== null && hasNext(queue) };
}

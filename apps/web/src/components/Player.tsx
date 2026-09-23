import { type Locale, playerMessages } from "@bandplate/i18n";
// The persistent player — one `<audio>` element, rendered once in
// `AppLayout.astro` and kept alive across navigation via
// `transition:persist` on its usage there. Astro persists an island's DOM
// node instead of destroying and recreating it on a ClientRouter
// navigation, so this component itself is never unmounted mid-session —
// which is what makes "keeps playing while you browse to another page"
// work with zero custom cross-page state transfer: the `<audio>` element
// (and its `currentTime`/`paused` state, which the browser owns, not us)
// simply never goes away.
//
// Every play/solo control on the site (TakeRow's leading slot, the take
// detail hero, the stems drawer) is PLAIN MARKUP, not its own island — a
// `<button data-audio-source data-take-id=... data-asset-id=... ...>`
// with no JS of its own. This component delegates clicks from `document`
// (the same pattern `ConfirmDialog.tsx` uses for `[data-confirm]`, and for
// the same reason: Astro replaces `<body>` on every view-transition
// navigation, so a listener bound to a specific element goes stale the
// moment the user navigates — delegating from `document`, which itself
// persists, and re-querying inside the handler is what survives that).
// One hydrated island instead of N per-row islands keeps the JS budget to
// one shared chunk regardless of how many take rows are on a page — see
// task-7-report.md for its gzipped size.
//
// State lives in `player-store.ts` (nanostores) rather than component
// state for the reason the brief calls out directly: a `.astro` page needs
// to read "is take X currently playing" to render a row's initial
// aria-pressed correctly on first paint — impossible if the only source of
// truth were inside this Preact tree. In practice every row is rendered
// server-side unaware of playback state (it can't know — playback is a
// client-only, cross-page concept) and instead gets its correct
// pressed/playing state from `syncButtons()` below, right after hydration
// and again after every navigation.
import { useStore } from "@nanostores/preact";
import { ChevronUp, Pause, Play, SkipBack, SkipForward, X } from "lucide-preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";
import { MIN_MIXER_STEMS } from "../client/mixer-tracks.js";
import {
  type ClickedSource,
  controlState,
  decidePlayerClickAction,
} from "../client/player-actions.js";
import {
  classifyPlayError,
  decideOnEnded,
  decideOnVisible,
  decidePrefetch,
  type PendingAdvance,
  type PlayFailure,
  type PrefetchKey,
  prefetchedSource,
  revocable,
  sessionStateOnPause,
} from "../client/player-prefetch.js";
import {
  canGoPrevious,
  decidePrevious,
  hasNext,
  nextIndex,
  type QueueItem,
  queueFrom,
  sameQueue,
  sheetHasContent,
} from "../client/player-queue.js";
import {
  AUDIO_SOURCE_ATTR,
  audioUrl,
  currentTrack,
  downsamplePeaks,
  isPlaying,
  type PlayerSource,
  type PlayerTrack,
  parsePeaksBody,
  peaksUrl,
  playQueue,
  sourcesUrl,
} from "../client/player-store.js";
import {
  controlDropsFocus,
  drawnBarCount,
  nowPlayingAnnouncement,
  playerSubtitle,
  queueableItem,
  queueItemOf,
  readSourceControl,
  remoteTransport,
  seekValueText,
  showsMixer,
  stemCount,
} from "../client/player-view.js";
import {
  barCountForWidth,
  finiteDuration,
  formatClock,
  playedFraction,
} from "../client/timeline.js";
import { NowPlayingSheet } from "./NowPlayingSheet.tsx";

/**
 * How wide one bar plus its gap should be, in CSS pixels.
 *
 * The bar COUNT is derived from this and the measured rail, rather than
 * fixed: bars are `flex: 1 1 0`, so a fixed count means the browser divides
 * whatever width it has between them, and 120 bars that look right on a
 * 340px phone become 14px slabs on a 1800px desktop. Deriving the count
 * instead keeps one density everywhere and gives a wide screen the detail it
 * has room for.
 */
const BAR_PITCH_PX = 3;

/** Until the rail has been measured — and in any environment with no `ResizeObserver`. */
const WAVEFORM_BARS = 120;

/** Floor and ceiling on the derived count: never a handful of slabs, never more bars than the file has samples to fill them (`downsamplePeaks` would just repeat buckets). */
const MIN_WAVEFORM_BARS = 60;
const MAX_WAVEFORM_BARS = 1000;

/**
 * Everything the player says, in the language of the page it is standing in.
 *
 * Read at RENDER time from `<html lang>`, not captured at module load: this
 * island is `transition:persist`, so it is moved between pages rather than
 * remounted, and a value frozen at hydration would be whatever the first page
 * happened to say. `currentLocale()` explains the rest.
 */
function playerText(fallback?: Locale) {
  return playerMessages(currentLocale(fallback));
}

/**
 * The list a toggle was pressed in, as queue items, in document order. Only
 * plain master toggles count, which is every play control a take row has:
 * a queued take starts on its master. A toggle outside any
 * `[data-play-queue]` is a queue of one.
 */
function readQueueAround(target: HTMLElement, clicked: ClickedSource): QueueItem[] {
  const container = target.closest<HTMLElement>("[data-play-queue]");
  return container ? readQueueIn(container) : [queueItemOf(clicked)];
}

function readQueueIn(container: HTMLElement): QueueItem[] {
  const items: QueueItem[] = [];
  for (const el of container.querySelectorAll<HTMLElement>(`[${AUDIO_SOURCE_ATTR}]`)) {
    const data = readSourceControl(el.dataset);
    const entry = data && queueableItem(data);
    if (entry) {
      items.push(entry);
    }
  }
  return items;
}

/** Updates every `[data-audio-source]` element currently in the DOM to reflect the live player state — aria-pressed, a few CSS hooks, and (for plain toggle buttons) the aria-label. Called on every store change and after every navigation (`astro:page-load`), since Astro swaps in fresh, unsynced elements on each page. What each control should show is `controlState` in `player-actions.ts`; this only writes it. */
function syncButtons(track: PlayerTrack | null, playing: boolean): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${AUDIO_SOURCE_ATTR}]`)) {
    const data = readSourceControl(el.dataset);
    if (!data) {
      continue;
    }
    const state = controlState(track, playing, data);
    el.setAttribute("aria-pressed", String(state.pressed));
    el.classList.toggle("is-active", state.selected);
    // The take, not the source: a take row stays the current one while a
    // stem of it plays, and the row fill in components.css keys on this.
    el.classList.toggle("is-current-take", state.currentTake);
    el.classList.toggle("is-playing", state.playing);
    // A source pill is named by its own text ("Master", "Basa"); only the
    // play/pause toggles carry a label that changes with playback.
    if (data.role !== "source-select") {
      el.setAttribute(
        "aria-label",
        state.playing ? playerText().pause(data.title) : playerText().play(data.title),
      );
    }
  }
}

/**
 * `play()` for the fire-and-forget callers. A second `src` change before the
 * first `play()` settles (Next, Next, Next) rejects the earlier promise with
 * an AbortError: that is the browser saying "superseded", not a failure, and
 * left alone it lands in the console as an unhandled rejection on every
 * rapid skip. Anything else (a NotAllowedError, say) still surfaces.
 */
function playQuietly(audio: HTMLAudioElement): void {
  audio.play().catch((error: unknown) => {
    if ((error as { name?: unknown } | null)?.name !== "AbortError") {
      throw error;
    }
  });
}

/**
 * `play()` for the paths no gesture is behind (the queue advancing on its own,
 * the page coming back after one that did not take). Nothing is rethrown:
 * a `NotAllowedError` there is the browser's rule, not a bug, and the caller
 * reads the outcome instead. `null` means it is playing.
 */
function playUnattended(audio: HTMLAudioElement): Promise<PlayFailure | null> {
  return audio.play().then(
    () => null,
    (error: unknown) => classifyPlayError(error),
  );
}

/** The lock screen's own play state. Explicit rather than derived, so the switch between two takes never reads as a stop. */
function setSessionState(state: MediaSessionPlaybackState): void {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

/** The prefetch slot: what it is for, the fetch to abort, and the object URL once the bytes are in (still `null` if the fetch failed, which is kept so it is not retried four times a second). */
interface PrefetchEntry {
  key: PrefetchKey;
  url: string | null;
  controller: AbortController;
}

export default function Player({ locale }: { locale?: Locale } = {}) {
  const track = useStore(currentTrack);
  const playing = useStore(isPlaying);
  const queue = useStore(playQueue);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  /** The waveform's own box — measured to decide how many bars fit. */
  const trackRef = useRef<HTMLSpanElement>(null);
  // A source switch on the take already playing must preserve
  // `currentTime` — `loadedmetadata` for the NEW source is the first
  // point `currentTime` can be legally set, so the seek (and any pending
  // resume) is applied there instead of immediately after `audio.src = `.
  const pendingSeekRef = useRef<number | null>(null);
  const pendingAutoplayRef = useRef(false);
  /** Read by `playIndex`, which is a stable callback and so cannot close over the state itself. */
  const sheetOpenRef = useRef(false);

  // The next take's audio, fetched while this one plays (see
  // `player-prefetch.ts` for why and when). At most one at a time. Every
  // object URL made here is in `createdUrlsRef` until it is revoked; the one
  // on the element is `playingUrlRef`. A stash row's own URL is never in
  // either, so it is never revoked here.
  const prefetchRef = useRef<PrefetchEntry | null>(null);
  const createdUrlsRef = useRef(new Set<string>());
  const playingUrlRef = useRef<string | null>(null);
  /** An automatic advance not yet heard: what `visibilitychange` recovers. */
  const pendingAdvanceRef = useRef<PendingAdvance | null>(null);

  /** Revokes every object URL made here that is neither on the element nor the held prefetch. */
  const releaseUrls = useCallback(() => {
    const created = createdUrlsRef.current;
    for (const url of revocable([...created], [playingUrlRef.current, prefetchRef.current?.url])) {
      URL.revokeObjectURL(url);
      created.delete(url);
    }
  }, []);

  /** Every `audio.src` change goes through here, so the object URL it replaces is let go. */
  const setSource = useCallback(
    (audio: HTMLAudioElement, src: string | null, fromPrefetch: boolean) => {
      if (src === null) {
        audio.removeAttribute("src");
      } else {
        audio.src = src;
      }
      playingUrlRef.current = fromPrefetch ? src : null;
      releaseUrls();
    },
    [releaseUrls],
  );

  const dropPrefetch = useCallback(() => {
    const held = prefetchRef.current;
    if (!held) return;
    prefetchRef.current = null;
    held.controller.abort();
    releaseUrls();
  }, [releaseUrls]);

  // Same route the element would ask, so the same auth, the same 302 to a
  // presigned URL and the same bucket CORS the waveform fetch already relies
  // on. `same-origin` credentials: the session cookie goes to our route and
  // nothing goes to the bucket, which a credentialed CORS request would need
  // the bucket to allow explicitly.
  const startPrefetch = useCallback((key: PrefetchKey) => {
    const entry: PrefetchEntry = { key, url: null, controller: new AbortController() };
    prefetchRef.current = entry;
    fetch(audioUrl(key.assetId), { signal: entry.controller.signal, credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`prefetch ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        // Replaced or dropped while the body was still arriving.
        if (prefetchRef.current !== entry) return;
        const url = URL.createObjectURL(blob);
        createdUrlsRef.current.add(url);
        entry.url = url;
      })
      .catch(() => {
        // Aborted, or the network said no: `ended` takes the network path,
        // exactly as before this existed.
      });
  }, []);

  /** Brings the prefetch slot in line with the queue and the playhead. Cheap; runs on every `timeupdate`. */
  const syncPrefetch = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const decision = decidePrefetch({
      queue: playQueue.get(),
      held: prefetchRef.current?.key ?? null,
      playing: !audio.paused,
      position: audio.currentTime,
      duration: audio.duration,
    });
    if (decision.discard) dropPrefetch();
    if (decision.start) startPrefetch(decision.start);
  }, [dropPrefetch, startPrefetch]);

  // The one way a queued take gets onto the `<audio>` element — used by the
  // click handler's "start-track"/Play-all paths and by the Next/Previous
  // buttons alike, so there is exactly one place that touches `audio.src`
  // for a track change.
  //
  // `unattended` is the queue advancing by itself: no gesture behind it, so
  // a refused `play()` is expected rather than thrown, and the lock screen is
  // told it is still playing across the switch.
  const startItem = useCallback(
    (item: QueueItem, unattended = false) => {
      const audio = audioRef.current;
      if (!audio) return;
      pendingSeekRef.current = null;
      pendingAutoplayRef.current = false;
      pendingAdvanceRef.current = null;
      const src = prefetchedSource(item, prefetchRef.current);
      const fromPrefetch = !item.src && src !== undefined;
      // The bytes move from the prefetch slot onto the element: not aborted,
      // not revoked, just no longer the prefetch.
      if (fromPrefetch) prefetchRef.current = null;
      // The identity is the take's, never the blob's: `src` on the track
      // means "a recording only this device has", which would hide the
      // waveform and the source list of a take the server does have.
      currentTrack.set({
        takeId: item.takeId,
        title: item.title,
        subtitle: item.subtitle,
        sourceAssetId: item.assetId,
        sourceKind: "master",
        sourceName: "",
        src: item.src,
      });
      // A recording still on this device plays from the object URL its row
      // owns, a prefetched take from memory, everything else from the asset
      // route.
      setSource(audio, src ?? audioUrl(item.assetId), fromPrefetch);
      if (!unattended) {
        playQuietly(audio);
        return;
      }
      // Straight away, not on the next render: a phone with the screen off
      // may not give this page another render before it decides nothing is
      // playing.
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: item.title,
          artist: item.subtitle,
        });
      }
      setSessionState("playing");
      void playUnattended(audio).then((failure) => {
        if (failure === "refused" || failure === "failed") setSessionState("paused");
      });
    },
    [setSource],
  );

  const playIndex = useCallback(
    (index: number, unattended = false) => {
      const queue = playQueue.get();
      const item = queue?.items[index];
      if (!queue || !item) return;
      const next = { ...queue, index };
      // Next into the last take (or Previous into the first) disables the
      // button that was just pressed, and a focused element that becomes
      // disabled drops focus to <body>. Hand it to the play/pause button on
      // the same surface, bar or sheet, before the re-render disables it.
      // Covers auto-advance too, which can end the queue under a focused
      // Next just the same.
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        controlDropsFocus(
          next,
          focused.hasAttribute("data-player-next")
            ? "next"
            : focused.hasAttribute("data-player-prev")
              ? "previous"
              : null,
        )
      ) {
        focused
          .closest(".bp-player-transport, .bp-now-playing-foot")
          ?.querySelector<HTMLElement>(".bp-player-play")
          ?.focus();
      }
      // The track first, then the queue: moving the queue re-checks the
      // prefetch slot at once, and a prefetch of THIS take is no longer "the
      // next one" by then. `startItem` has to take it off the slot first.
      startItem(item, unattended);
      playQueue.set(next);
      // Only the queue moving the track (Next, Previous, auto-advance, the
      // Hraje sheet's own order list) scrolls the row into view — a user's
      // own tap on `start-track` skips this because they are already
      // looking at that row. Nor while the sheet is open: the page is inert
      // and covered, and scrolling it there moves something nobody can see.
      // `scrollIntoView` alone stops at the SCROLL CONTAINER's edge, which is
      // well behind the fixed player bar and tab bar; `.bp-take-row`'s
      // `scroll-margin-bottom` (components.css) is what actually keeps the
      // row clear of them.
      if (sheetOpenRef.current) return;
      const row = document
        .querySelector(`[data-play-queue] [data-take-id="${CSS.escape(item.takeId)}"]`)
        ?.closest(".bp-take-row");
      row?.scrollIntoView({
        block: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    },
    [startItem],
  );

  const goNext = useCallback(() => {
    const index = nextIndex(playQueue.get());
    if (index !== null) playIndex(index);
  }, [playIndex]);

  const goPrevious = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const action = decidePrevious(playQueue.get(), audio.currentTime);
    if (action.kind === "go") {
      playIndex(action.index);
    } else {
      audio.currentTime = 0;
    }
  }, [playIndex]);

  // The one play/pause toggle, shared by the bar's own button and the Hraje
  // sheet's foot transport — `showModal()` makes the bar inert while the
  // sheet is open, so the sheet needs its own control wired to the same
  // effect rather than a duplicate copy of this logic.
  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      playQuietly(audio);
    } else {
      audio.pause();
    }
  }, []);

  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(0);
  // `null` means "not fetched or none exists" — both render the plain rail,
  // and deliberately so: a take with no waveform is not an error state, it
  // is every take until something computes peaks.
  // The file's own values, NOT the drawn bars: the bar count depends on how
  // wide the rail is, so downsampling happens at render and a resize redraws
  // without re-fetching.
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [barCount, setBarCount] = useState(WAVEFORM_BARS);
  const [sources, setSources] = useState<PlayerSource[] | null>(null);
  /** How many of them are stems — what decides whether a mixer is worth offering. */
  const stems = stemCount(sources);
  /** Whether the Hraje sheet is showing — the title button opens it, `NowPlayingSheet` renders it. */
  const [sheetOpen, setSheetOpen] = useState(false);
  sheetOpenRef.current = sheetOpen;

  // `playIndex` closed over by `onEnded` below, which is registered once
  // (`[]` deps, same reason as the click handler) — the ref is what lets it
  // see the current callback instead of the one from first mount.
  const playIndexRef = useRef(playIndex);
  playIndexRef.current = playIndex;

  // Wires the real DOM events (not our own click handler's optimistic
  // guess) to `isPlaying` — this is what keeps the store honest when the
  // native `<audio controls>` UI itself is used to pause/play, not just
  // when a `[data-audio-source]` button is clicked.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const onPlay = () => {
      isPlaying.set(true);
      setSessionState("playing");
      syncPrefetch();
    };
    const onPause = () => {
      isPlaying.set(false);
      // The pause the element fires right before `ended` is not one.
      setSessionState(sessionStateOnPause(audio.ended, playQueue.get()));
    };
    // Heard: whatever advance was pending has taken.
    const onPlaying = () => {
      pendingAdvanceRef.current = null;
    };
    // Advances the queue rather than just stopping — see `player-queue.ts`
    // for what "next" means. `stop` (no queue, or already at the end) is
    // the ordinary stop. The advance plays from the prefetched bytes when
    // they are in (`startItem`), and is remembered until it is heard, so a
    // page frozen before it could start can pick it up again.
    const onEnded = () => {
      const action = decideOnEnded(playQueue.get());
      if (action.kind === "stop") {
        isPlaying.set(false);
        return;
      }
      playIndexRef.current(action.index, true);
      const item = playQueue.get()?.items[action.index];
      if (item) {
        pendingAdvanceRef.current = {
          index: action.index,
          takeId: item.takeId,
          hidden: document.visibilityState === "hidden",
        };
      }
    };
    const onTime = () => {
      setPlayhead(audio.currentTime);
      syncPrefetch();
    };
    const onDuration = () => {
      setDuration(finiteDuration(audio.duration));
      syncPrefetch();
    };
    // Back from the background after an advance that never got going: the
    // take that should be playing, from 0:00. Played if the browser allows
    // it; if not, it sits paused with the play button ready.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const action = decideOnVisible({
        pending: pendingAdvanceRef.current,
        queue: playQueue.get(),
        silent: audio.paused || audio.error !== null,
      });
      if (action.kind !== "resume") return;
      pendingAdvanceRef.current = null;
      // Same source, loaded afresh: `load()` rewinds to 0:00 and clears an
      // errored element. An object URL there is still the playing source,
      // so it has not been revoked.
      audio.load();
      setPlayhead(0);
      void playUnattended(audio).then((failure) => {
        if (failure) {
          isPlaying.set(false);
          setSessionState("paused");
        }
      });
    };
    // The queue changing under a held prefetch (a new list, Previous, the
    // sheet's order list) decides at once whether it is still the next take.
    const unlistenQueue = playQueue.listen(() => syncPrefetch());
    const onLoadedMetadata = () => {
      setDuration(finiteDuration(audio.duration));
      if (pendingSeekRef.current !== null) {
        audio.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
      if (pendingAutoplayRef.current) {
        pendingAutoplayRef.current = false;
        playQuietly(audio);
      }
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unlistenQueue();
      document.removeEventListener("visibilitychange", onVisibility);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      dropPrefetch();
      for (const url of createdUrlsRef.current) URL.revokeObjectURL(url);
      createdUrlsRef.current.clear();
      playingUrlRef.current = null;
    };
  }, [syncPrefetch, dropPrefetch]);

  // The delegated click handler — the one piece of JS every play/solo
  // control on the site actually depends on. Registered once; this
  // component is never unmounted mid-session (see the header comment), so
  // there's no re-binding-after-navigation problem the way a
  // page-scoped script would have.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Play all: not a `[data-audio-source]` control at all, so it has to
      // be checked before that lookup below returns early for it.
      const startButton = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-play-queue-start]",
      );
      if (startButton) {
        const container = document.getElementById(startButton.dataset.playQueueStart ?? "");
        const items = container ? readQueueIn(container) : [];
        const first = items[0];
        if (first) {
          event.preventDefault();
          playQueue.set({ items, index: 0 });
          startItem(first);
        }
        return;
      }

      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        `[${AUDIO_SOURCE_ATTR}]`,
      );
      if (!target) {
        return;
      }
      const data = readSourceControl(target.dataset);
      const audio = audioRef.current;
      if (!data || !audio) {
        return;
      }
      event.preventDefault();

      // The decision (which of "toggle" / "switch source, preserve
      // position" / "start a new track" applies) is a pure function —
      // see `player-actions.ts` and its own test for the logic itself.
      // Only the DOM/audio-element side effects happen here.
      const action = decidePlayerClickAction(currentTrack.get(), data);

      switch (action.kind) {
        case "noop":
          break;
        case "toggle-playback": {
          // The current take, tapped in a DIFFERENT list than the one it was
          // started from (the song page after the session page, say): a
          // pause or a resume, never a restart, but from here on Next
          // follows the list that was tapped. Only inside a list: a lone
          // toggle (the take page's hero, a pinned plate) is a queue of one,
          // and pausing there must not throw away the session's queue.
          const list = target.closest<HTMLElement>("[data-play-queue]");
          if (list) {
            const queue = queueFrom(readQueueIn(list), data.takeId);
            if (!sameQueue(playQueue.get(), queue)) {
              playQueue.set(queue);
            }
          }
          if (audio.paused) {
            playQuietly(audio);
          } else {
            audio.pause();
          }
          break;
        }
        case "switch-source":
          pendingSeekRef.current = audio.currentTime;
          pendingAutoplayRef.current = !audio.paused;
          pendingAdvanceRef.current = null;
          setSource(audio, action.track.src ?? audioUrl(action.track.sourceAssetId), false);
          // `preload="none"` means changing `.src` alone does NOT start
          // fetching — `loadedmetadata` (which applies the pending seek
          // below) would never fire while paused, silently stranding the
          // position at 0. `.load()` forces the fetch unconditionally,
          // whether or not this switch also resumes playback.
          audio.load();
          currentTrack.set(action.track);
          break;
        case "start-track": {
          // The queue is the list this take was clicked from — snapshotted
          // now, since the DOM it's read from may not survive the next
          // navigation. Every control that can land here is a master
          // toggle: the only stem controls left are the Hraje sheet's
          // source pills, and those always belong to the take already
          // loaded, so they switch source instead of starting anything.
          const queue = queueFrom(readQueueAround(target, data), data.takeId);
          playQueue.set(queue);
          startItem(queueItemOf(data));
          break;
        }
      }
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
    // `startItem` and `setSource` are stable (`useCallback` over refs), so the once-registered
    // listener closes over the same function this effect ran with — listed
    // to satisfy the linter, not because it ever changes and re-binds this.
  }, [startItem, setSource]);

  // Keep every on-page control in sync with the store — on every state
  // change, AND after every view-transition navigation (fresh, unsynced
  // elements land in the DOM with no memory of the player's state).
  // `sources` too: the sheet's source pills mount when the take's source
  // list arrives, after the track change that asked for it. The sheet
  // renders their selected state itself; this adds the classes it leaves
  // to `syncButtons`, so the pills match every other control.
  useEffect(() => {
    syncButtons(track, playing);
  }, [track, playing, sources]);
  useEffect(() => {
    function onPageLoad() {
      syncButtons(currentTrack.get(), isPlaying.get());
    }
    document.addEventListener("astro:page-load", onPageLoad);
    return () => document.removeEventListener("astro:page-load", onPageLoad);
  }, []);

  // The sheet must never sit open over nothing (the bar's close button
  // clears `track`) or over a page that swapped underneath it — a
  // `showModal()` dialog is otherwise perfectly happy to keep the top layer
  // through a navigation, which would leave the OLD take's sheet open on the
  // NEW page.
  useEffect(() => {
    if (!track) {
      setSheetOpen(false);
    }
  }, [track]);
  useEffect(() => {
    function onBeforeSwap() {
      setSheetOpen(false);
    }
    document.addEventListener("astro:before-swap", onBeforeSwap);
    return () => document.removeEventListener("astro:before-swap", onBeforeSwap);
  }, []);

  // The lock screen / headphones remote — same transport this bar exposes,
  // routed through the OS instead of a touch. `previoustrack` is offered
  // whenever a queue exists at all (Previous always does something: go back,
  // or restart), `nexttrack` only when there's somewhere to go, so a
  // headphone press can't act on a control this bar itself doesn't show as
  // available (see the no-fake-affordances rule).
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    session.metadata = track
      ? new MediaMetadata({ title: track.title, artist: track.subtitle })
      : null;
    const offered = remoteTransport(track, queue);
    session.setActionHandler("previoustrack", offered.previous ? goPrevious : null);
    session.setActionHandler("nexttrack", offered.next ? goNext : null);
  }, [track, queue, goNext, goPrevious]);

  // The waveform for whatever source is loaded. Re-fetched on every source
  // switch, which is the entire reason peaks are stored per asset rather
  // than per take — see `peaksStorageKey`. A 404 is the ordinary case today
  // (nothing computes peaks yet) and lands on `null`, i.e. the plain rail.
  // A recording still on this device: the server has no asset behind it, so
  // there are no peaks and no source list to ask for. Both fetches would 404
  // on an id only this browser knows.
  const localSource = Boolean(track?.src);
  const sourceAssetId = track?.sourceAssetId;
  useEffect(() => {
    if (!sourceAssetId || localSource) {
      setPeaks(null);
      return;
    }
    let cancelled = false;
    setPeaks(null);
    fetch(peaksUrl(sourceAssetId))
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (cancelled) {
          return;
        }
        // Both the contract's bare array and the older wrapped shape; see
        // `parsePeaksBody`.
        setPeaks(parsePeaksBody(body));
      })
      .catch(() => {
        if (!cancelled) {
          setPeaks(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceAssetId, localSource]);

  // What this take can be heard as — fetched with the take rather than on
  // opening the sheet, because whether the title opens a sheet at all
  // depends on the answer.
  const takeId = track?.takeId;
  // Cleared on every take change first, so a take with no fetch yet in
  // flight never reports the PREVIOUS take's source count — that count
  // feeds `canOpenSheet` and the subtitle's source label below. The gate
  // is on the TAKE, not on anything being open: the list loads with the
  // track, and the Hraje sheet reads it whenever it renders.
  useEffect(() => {
    setSources(null);
    if (!takeId || localSource) {
      setSources([]);
      return;
    }
    let cancelled = false;
    fetch(sourcesUrl(takeId))
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { sources?: PlayerSource[] } | null) => {
        if (!cancelled) {
          setSources(body?.sources ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSources([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [takeId, localSource]);

  // Keeps `--bp-player-height` (declared on `.bp-shell`, consumed by
  // `.bp-shell-main`'s reserved bottom padding — see components.css) equal
  // to this bar's REAL rendered height, rather than a hand-copied number
  // that can silently drift out of sync with it (exactly what happened
  // before: a declared 76px vs. a measured 109px, occluding the bottom of
  // every page at >=1024px). `.bp-shell` itself is replaced on every
  // ClientRouter navigation (this island is the one thing that persists —
  // see the header comment), so it's re-queried fresh each time rather
  // than cached in a ref. Skipped while the player is `[hidden]` (no track
  // yet loaded): its real height is then 0, and the static fallback
  // declared in CSS is what should apply until a track actually loads.
  useEffect(() => {
    const playerEl = playerRef.current;
    if (!playerEl) {
      return;
    }
    const observer = new ResizeObserver(() => applyHeights());
    // The tab bar is NOT persisted — a fresh element on every navigation —
    // so the old one is dropped and the new one picked up each time.
    let observedTabbar: Element | null = null;

    const applyHeights = () => {
      const shell = document.querySelector<HTMLElement>(".bp-shell");
      if (!shell) {
        return;
      }
      const height = playerEl.getBoundingClientRect().height;
      if (height > 0) {
        shell.style.setProperty("--bp-player-height", `${height}px`);
      }

      // The tab bar's height was hardcoded in `.bp-player`'s `bottom` as
      // `57px` — 56px of `.bp-tabbar-item` plus its 1px border — which is
      // only true at the browser's default font size. Raise the system font
      // (Android's display size, or a browser minimum-font-size setting) and
      // the labels push the bar taller, the player stays where 57px put it,
      // and the page shows through the strip between them. Same class of bug
      // as the declared-76px-vs-measured-109px one above, so the same fix:
      // measure it. The measurement already includes the bar's own
      // `env(safe-area-inset-bottom)` padding, which is why the CSS fallback
      // adds that inset and this value must not.
      const tabbar = document.querySelector<HTMLElement>(".bp-tabbar");
      if (tabbar !== observedTabbar) {
        if (observedTabbar) {
          observer.unobserve(observedTabbar);
        }
        observedTabbar = tabbar;
        if (tabbar) {
          observer.observe(tabbar);
        }
      }
      const tabbarHeight = tabbar?.getBoundingClientRect().height ?? 0;
      if (tabbarHeight > 0) {
        shell.style.setProperty("--bp-tabbar-height", `${tabbarHeight}px`);
      } else {
        // Hidden (desktop) or gone: hand `bottom` back to the CSS fallback
        // rather than pinning it to a stale phone-sized number.
        shell.style.removeProperty("--bp-tabbar-height");
      }
    };

    observer.observe(playerEl);
    document.addEventListener("astro:page-load", applyHeights);
    applyHeights();
    return () => {
      observer.disconnect();
      document.removeEventListener("astro:page-load", applyHeights);
    };
  }, []);

  const t = playerText(locale);
  const announced = nowPlayingAnnouncement(track, t);

  // One bar per `BAR_PITCH_PX` of actual rail. Observed rather than read once:
  // the player is persistent, so it outlives rotations, window drags and the
  // viewport change when the mobile keyboard opens, and a stale count would
  // stretch or crowd the bars until the next track.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = (width: number) => {
      const count = barCountForWidth(width, {
        pitch: BAR_PITCH_PX,
        min: MIN_WAVEFORM_BARS,
        max: MAX_WAVEFORM_BARS,
      });
      if (count !== null) {
        setBarCount(count);
      }
    };
    measure(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        measure(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const bars = useMemo(
    () => (peaks ? downsamplePeaks(peaks, drawnBarCount(barCount, peaks.length)) : []),
    [peaks, barCount],
  );
  const progress = playedFraction(playhead, duration);

  // The queue's own position — "3 of 10" — distinct from `playhead`, the
  // scrub position in seconds, which is why that state was renamed above.
  const subtitleLine = playerSubtitle({ track, sources, queue, t });
  const canOpenSheet = sheetHasContent({
    sourceCount: sources?.length ?? 0,
    stemCount: stems,
    queueLength: queue?.items.length ?? 0,
    minMixerStems: MIN_MIXER_STEMS,
  });

  return (
    <div class="bp-player" hidden={!track} data-testid="bp-player" ref={playerRef}>
      {/* Track-change-only announcements — never touched by a timeupdate
          handler, which is what keeps this from spamming a screen reader on
          every second of playback. Inert while the Hraje sheet is open, so
          the sheet carries its own copy for that stretch. */}
      <p class="sr-only" aria-live="polite">
        {announced}
      </p>

      <div class="bp-player-row">
        {/* Transport first. There was a plate here — the app's mark, turning
            while the take played — and it read as a control sitting where a
            control belongs without being one. The bar is chrome you operate,
            not a picture of a record player. */}
        <div class="bp-player-transport">
          <button
            type="button"
            class="bp-player-skip"
            data-player-prev
            disabled={!canGoPrevious(queue, playhead)}
            onClick={goPrevious}
            aria-label={t.previous}
          >
            <SkipBack size={20} aria-hidden="true" fill="currentColor" />
          </button>
          {/* Its own class, sharing the take row's rules rather than its
              NAME — `.bp-play-toggle` means "this take's play control", and a
              route test rightly asserts a take with nothing playable renders
              none. The shell's player is on every page, so borrowing the class
              made that assertion unprovable. Same 44px box and 34px disc
              either way: the two selectors sit on one rule in components.css,
              so they cannot drift. */}
          <button
            type="button"
            class="bp-player-play"
            aria-pressed={playing}
            aria-label={playing ? t.pause(track?.title ?? "") : t.play(track?.title ?? "")}
            onClick={togglePlayback}
          >
            {playing ? (
              <Pause size={18} aria-hidden="true" fill="currentColor" />
            ) : (
              <Play size={18} aria-hidden="true" fill="currentColor" />
            )}
          </button>
          {/* Always there, disabled on the last take: the transport keeps its
              shape, so play never jumps sideways when the queue runs out. */}
          <button
            type="button"
            class="bp-player-skip"
            data-player-next
            disabled={!hasNext(queue)}
            onClick={goNext}
            aria-label={t.next}
          >
            <SkipForward size={20} aria-hidden="true" fill="currentColor" />
          </button>
        </div>

        {/* The title is the way into the "Hraje" sheet — what's playing,
            what it could switch to, and where it sits in the queue. Plain
            text when there is nothing the sheet would show: a control that
            cannot work is not rendered (no fake affordances). */}
        {canOpenSheet ? (
          <button
            type="button"
            class="bp-player-meta bp-player-meta-button"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-label={t.openNowPlaying(track?.title ?? "")}
            onClick={() => setSheetOpen(true)}
          >
            <span class="bp-player-title-line">
              <span class="bp-player-title">{track?.title ?? ""}</span>
              <ChevronUp size={13} class="bp-player-meta-caret" aria-hidden="true" />
            </span>
            <span class="bp-player-subtitle">{subtitleLine}</span>
          </button>
        ) : (
          <div class="bp-player-meta">
            <span class="bp-player-title">{track?.title ?? ""}</span>
            <span class="bp-player-subtitle">{subtitleLine}</span>
          </div>
        )}

        {/* Put it away. The bar is permanent chrome that appears the moment
            you press play and then never leaves — this stops playback and
            clears the track, which is the honest meaning of "hide it": a bar
            that hid itself while still playing would be a sound with no
            visible control anywhere on the page. */}
        <button
          type="button"
          class="bp-player-close"
          aria-label={t.close}
          onClick={() => {
            const audio = audioRef.current;
            pendingAdvanceRef.current = null;
            if (audio) {
              audio.pause();
              setSource(audio, null, false);
              audio.load();
            }
            isPlaying.set(false);
            currentTrack.set(null);
            playQueue.set(null);
            setSessionState("none");
          }}
        >
          <X size={16} aria-hidden="true" strokeWidth={2.2} />
        </button>
      </div>

      <div class="bp-player-scrub">
        <span class="bp-player-time">{formatClock(playhead)}</span>
        {/* The seek control is a REAL `<input type="range">`, sized over the
            drawing and visually transparent. That is what keeps everything
            the native `<audio controls>` used to give for free — keyboard
            operability, arrow-key stepping, a labelled value a screen reader
            can read — while letting us draw the waveform ourselves. The bars
            behind it are `aria-hidden` decoration; the range is the control. */}
        <span class="bp-player-track" ref={trackRef}>
          {bars.length > 0 ? (
            <span class="bp-player-wave" aria-hidden="true">
              {bars.map((value, i) => (
                <span
                  // Index is the identity: a fixed-length list of positions
                  // along one timeline, not a list of things.
                  key={i}
                  class={`bp-player-bar${i / bars.length <= progress ? " is-played" : ""}`}
                  style={{ height: `${Math.max(8, value * 100)}%` }}
                />
              ))}
            </span>
          ) : (
            // No peaks — the take just has no picture yet. Not an error and
            // not an empty state: a plain rail, which is a truthful control.
            <span class="bp-player-rail" aria-hidden="true">
              <span class="bp-player-rail-fill" style={{ width: `${progress * 100}%` }} />
            </span>
          )}
          <input
            type="range"
            class="bp-player-seek"
            min={0}
            max={duration || 0}
            step={0.01}
            value={playhead}
            disabled={duration <= 0}
            aria-label={t.seek}
            aria-valuetext={seekValueText(playhead, duration, t)}
            onInput={(event) => {
              const audio = audioRef.current;
              const next = Number((event.currentTarget as HTMLInputElement).value);
              if (audio && Number.isFinite(next)) {
                audio.currentTime = next;
                setPlayhead(next);
              }
            }}
          />
        </span>
        <span class="bp-player-time">{formatClock(duration)}</span>
      </div>

      {/* The title button's sheet — sources, the mixer link, the running
          order. Only mounted while there IS a track: an empty `PlayerTrack`
          has no title or takeId for the sheet to show. */}
      {track && (
        <NowPlayingSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          track={track}
          sources={sources}
          showMixer={showsMixer(sources)}
          queue={queue}
          onPick={playIndex}
          onPrevious={goPrevious}
          canPrevious={canGoPrevious(queue, playhead)}
          onNext={goNext}
          onToggle={togglePlayback}
          playing={playing}
          canNext={hasNext(queue)}
          announced={announced}
          t={t}
        />
      )}

      {/* No `controls`: the chrome above is ours now. Always in the DOM
          (never conditionally rendered) so the element's own playback state
          survives every track change — only the bar's visibility toggles. */}
      {/* biome-ignore lint/a11y/useMediaCaption: a captions track has no meaningful content for a band's own instrumental/vocal recordings — there's no dialogue to transcribe */}
      <audio ref={audioRef} preload="none" class="bp-player-audio" />
    </div>
  );
}

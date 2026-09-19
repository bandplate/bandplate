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
import { Fragment } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";
import { MIN_MIXER_STEMS } from "../client/mixer-tracks.js";
import { decidePlayerClickAction } from "../client/player-actions.js";
import {
  type QueueItem,
  decidePrevious,
  hasNext,
  nextIndex,
  queueFrom,
  queuePosition,
  sheetHasContent,
} from "../client/player-queue.js";
import {
  AUDIO_SOURCE_ATTR,
  type PlayerSource,
  type PlayerTrack,
  audioUrl,
  currentTrack,
  downsamplePeaks,
  isPlaying,
  peaksUrl,
  playQueue,
  sourcesUrl,
} from "../client/player-store.js";
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
 * mm:ss. Chivo's tabular figures (see `.bp-player-time`) keep it from shifting
 * as it ticks.
 *
 * NOT `@bandplate/i18n`'s `formatDuration`, despite looking like it. This is a
 * live clock reading `audio.currentTime`, so it FLOORS — rounding would show
 * 1:00 from 0:59.5 onward, half a second before the minute. The shared one
 * rounds, because it renders a stored `durationMs` where the nearest second is
 * the honest answer. Both are digits and colons in every language, so neither
 * takes a locale.
 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

interface SourceButtonData {
  takeId: string;
  assetId: string;
  title: string;
  subtitle: string;
  sourceKind: "master" | "stem";
  sourceName: string;
  /** "source-select" (the stems drawer) gets different aria-label phrasing than the default play/pause toggle. */
  role: string;
}

function readButtonData(el: HTMLElement): SourceButtonData | null {
  const { takeId, assetId, title } = el.dataset;
  if (!takeId || !assetId || !title) {
    return null;
  }
  return {
    takeId,
    assetId,
    title,
    subtitle: el.dataset.subtitle ?? "",
    // A control that says nothing about its source is the master — that is
    // what every plain play button on a row or a plate is.
    sourceKind: el.dataset.sourceKind === "stem" ? "stem" : "master",
    sourceName: el.dataset.sourceName ?? "",
    role: el.dataset.role ?? "toggle",
  };
}

/**
 * The list a toggle was pressed in, as queue items, in document order. Only
 * plain toggles count (not the take page's source chips), and only masters:
 * a queued take starts on its master. A toggle outside any
 * `[data-play-queue]` is a queue of one.
 */
function readQueueAround(target: HTMLElement, clicked: SourceButtonData): QueueItem[] {
  const container = target.closest<HTMLElement>("[data-play-queue]");
  const self = {
    takeId: clicked.takeId,
    assetId: clicked.assetId,
    title: clicked.title,
    subtitle: clicked.subtitle,
  };
  if (!container) {
    return [self];
  }
  return readQueueIn(container);
}

function readQueueIn(container: HTMLElement): QueueItem[] {
  const items: QueueItem[] = [];
  for (const el of container.querySelectorAll<HTMLElement>(`[${AUDIO_SOURCE_ATTR}]`)) {
    const data = readButtonData(el);
    if (data && data.role === "toggle" && data.sourceKind === "master") {
      items.push({
        takeId: data.takeId,
        assetId: data.assetId,
        title: data.title,
        subtitle: data.subtitle,
      });
    }
  }
  return items;
}

/** Updates every `[data-audio-source]` element currently in the DOM to reflect the live player state — aria-pressed, a couple of CSS hooks, and (for plain toggle buttons) the aria-label. Called on every store change and after every navigation (`astro:page-load`), since Astro swaps in fresh, unsynced elements on each page. */
function syncButtons(track: PlayerTrack | null, playing: boolean): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${AUDIO_SOURCE_ATTR}]`)) {
    const data = readButtonData(el);
    if (!data) {
      continue;
    }
    const isActiveSource =
      track !== null && track.takeId === data.takeId && track.sourceAssetId === data.assetId;
    const isActivePlaying = isActiveSource && playing;
    // `aria-pressed` means different things for the two roles this
    // delegated handler drives: a "source-select" chip (the Solo drawer)
    // is a SELECTOR, so its pressed state is "is this the selected
    // source" — playback state is irrelevant to it, and reporting
    // `isActivePlaying` there meant a paused-but-selected chip announced
    // as unpressed to a screen reader, indistinguishable from an
    // unselected one (review: fix round 1, item 3). The default "toggle"
    // role (play/pause buttons) keeps the play/pause semantics, where
    // pressed correctly means "currently playing".
    const ariaPressed = data.role === "source-select" ? isActiveSource : isActivePlaying;
    el.setAttribute("aria-pressed", String(ariaPressed));
    el.classList.toggle("is-active", isActiveSource);
    el.classList.toggle("is-playing", isActivePlaying);
    if (data.role !== "source-select") {
      el.setAttribute(
        "aria-label",
        isActivePlaying ? playerText().pause(data.title) : playerText().play(data.title),
      );
    }
  }
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

  // The one way a queued take gets onto the `<audio>` element — used by the
  // click handler's "start-track"/Play-all paths and by the Next/Previous
  // buttons alike, so there is exactly one place that touches `audio.src`
  // for a track change.
  const startItem = useCallback((item: QueueItem) => {
    const audio = audioRef.current;
    if (!audio) return;
    pendingSeekRef.current = null;
    pendingAutoplayRef.current = false;
    currentTrack.set({
      takeId: item.takeId,
      title: item.title,
      subtitle: item.subtitle,
      sourceAssetId: item.assetId,
      sourceKind: "master",
      sourceName: "",
    });
    audio.src = audioUrl(item.assetId);
    void audio.play();
  }, []);

  const playIndex = useCallback(
    (index: number) => {
      const queue = playQueue.get();
      const item = queue?.items[index];
      if (!queue || !item) return;
      playQueue.set({ ...queue, index });
      startItem(item);
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
      void audio.play();
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
  const stemCount = sources?.filter((source) => source.kind === "stem").length ?? 0;
  /** The title button opens this; Task 4 renders the sheet that reads it. */
  const [sheetOpen, setSheetOpen] = useState(false);

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
    const onPlay = () => isPlaying.set(true);
    const onPause = () => isPlaying.set(false);
    // Advances the queue rather than just stopping — see `player-queue.ts`
    // for what "next" means. `null` (no queue, or already at the end) is
    // the ordinary stop.
    const onEnded = () => {
      const index = nextIndex(playQueue.get());
      if (index === null) {
        isPlaying.set(false);
      } else {
        playIndexRef.current(index);
      }
    };
    const onTime = () => setPlayhead(audio.currentTime);
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      if (pendingSeekRef.current !== null) {
        audio.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
      if (pendingAutoplayRef.current) {
        pendingAutoplayRef.current = false;
        void audio.play();
      }
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
    };
  }, []);

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
      const data = readButtonData(target);
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
        case "toggle-playback":
          if (audio.paused) {
            void audio.play();
          } else {
            audio.pause();
          }
          break;
        case "switch-source":
          pendingSeekRef.current = audio.currentTime;
          pendingAutoplayRef.current = !audio.paused;
          audio.src = audioUrl(action.track.sourceAssetId);
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
          // navigation. A stem started from the take page's own chips isn't
          // read into any queue (`readQueueIn` only collects master
          // toggles), but it's still a start: `startItem` always begins on
          // the master, so its `currentTrack.set` below restores the
          // clicked stem as the active source.
          const queue = queueFrom(readQueueAround(target, data), data.takeId);
          playQueue.set(queue);
          startItem({
            takeId: data.takeId,
            assetId: data.assetId,
            title: data.title,
            subtitle: data.subtitle,
          });
          if (data.sourceKind === "stem") {
            currentTrack.set(action.track);
          }
          break;
        }
      }
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
    // `startItem` is stable (`useCallback` with `[]`), so the once-registered
    // listener closes over the same function this effect ran with — listed
    // to satisfy the linter, not because it ever changes and re-binds this.
  }, [startItem]);

  // Keep every on-page control in sync with the store — on every state
  // change, AND after every view-transition navigation (fresh, unsynced
  // elements land in the DOM with no memory of the player's state).
  useEffect(() => {
    syncButtons(track, playing);
  }, [track, playing]);
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
    session.setActionHandler("previoustrack", track ? goPrevious : null);
    session.setActionHandler("nexttrack", track && hasNext(queue) ? goNext : null);
  }, [track, queue, goNext, goPrevious]);

  // The waveform for whatever source is loaded. Re-fetched on every source
  // switch, which is the entire reason peaks are stored per asset rather
  // than per take — see `peaksStorageKey`. A 404 is the ordinary case today
  // (nothing computes peaks yet) and lands on `null`, i.e. the plain rail.
  const sourceAssetId = track?.sourceAssetId;
  useEffect(() => {
    if (!sourceAssetId) {
      setPeaks(null);
      return;
    }
    let cancelled = false;
    setPeaks(null);
    fetch(peaksUrl(sourceAssetId))
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { peaks?: unknown } | number[] | null) => {
        if (cancelled) {
          return;
        }
        // The ingest contract §5 specifies the file as "a single array of 1000
        // integers", and that is what the bridge writes. Reading only
        // `body.peaks` meant every waveform ingested to spec silently drew a
        // plain rail -- `[].peaks` is undefined, and the fallback below is
        // indistinguishable from a 404. The wrapped shape stays accepted.
        const raw = Array.isArray(body) ? body : body?.peaks;
        setPeaks(
          Array.isArray(raw) && raw.every((v) => typeof v === "number") ? (raw as number[]) : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setPeaks(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceAssetId]);

  // What this take can be heard as — fetched when the switch is OPENED, so a
  // take nobody switches on never pays for the request.
  const takeId = track?.takeId;
  // Cleared on every take change first, so a take with no fetch yet in
  // flight never reports the PREVIOUS take's source count — that count
  // feeds `canOpenSheet` and the subtitle's source label below. The gate
  // is on the TAKE, not on anything being open: the list loads with the
  // track, and Task 4's sheet reads it whenever it renders.
  useEffect(() => {
    setSources(null);
    if (!takeId) {
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
  }, [takeId]);

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
  const announced = !track
    ? ""
    : track.sourceKind === "stem"
      ? t.nowPlayingSource({ title: track.title, source: t.solo(track.sourceName) })
      : t.nowPlaying(track.title);

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
      if (width <= 0) {
        return;
      }
      setBarCount(
        Math.max(MIN_WAVEFORM_BARS, Math.min(MAX_WAVEFORM_BARS, Math.round(width / BAR_PITCH_PX))),
      );
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
    () => (peaks ? downsamplePeaks(peaks, Math.max(1, Math.min(barCount, peaks.length))) : []),
    [peaks, barCount],
  );
  const progress = duration > 0 ? playhead / duration : 0;

  // The queue's own position — "3 of 10" — distinct from `playhead`, the
  // scrub position in seconds, which is why that state was renamed above.
  const position = queuePosition(queue);
  const sourceLabel = !track ? "" : track.sourceKind === "stem" ? track.sourceName : t.master;
  const subtitleLine = [
    track?.subtitle,
    sources && sources.length > 1 ? sourceLabel : "",
    position ? t.position(position) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const canOpenSheet = sheetHasContent({
    sourceCount: sources?.length ?? 0,
    stemCount,
    queueLength: queue?.items.length ?? 0,
    minMixerStems: MIN_MIXER_STEMS,
  });

  return (
    <div class="bp-player" hidden={!track} data-testid="bp-player" ref={playerRef}>
      {/* Track-change-only announcements — never touched by a timeupdate
          handler, which is what keeps this from spamming a screen reader on
          every second of playback. */}
      <p class="sr-only" aria-live="polite">
        {announced}
      </p>

      <div class="bp-player-row">
        {/* Transport first. There was a plate here — the app's mark, turning
            while the take played — and it read as a control sitting where a
            control belongs without being one. The bar is chrome you operate,
            not a picture of a record player. */}
        <div class="bp-player-transport">
          <button type="button" class="bp-player-skip" onClick={goPrevious} aria-label={t.previous}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M6.5 5.5v13"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
              <path d="M18.5 5.8v12.4L9.5 12z" fill="currentColor" />
            </svg>
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
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="7" y="5" width="3.6" height="14" rx="1.2" />
                <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.2v13.6L19 12z" />
              </svg>
            )}
          </button>
          {hasNext(queue) && (
            <button type="button" class="bp-player-skip" onClick={goNext} aria-label={t.next}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M17.5 5.5v13"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                />
                <path d="M5.5 5.8v12.4l9-6.2z" fill="currentColor" />
              </svg>
            </button>
          )}
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
              <svg
                class="bp-player-meta-caret"
                viewBox="0 0 24 24"
                width="13"
                height="13"
                aria-hidden="true"
              >
                <path
                  d="M6 15l6-6 6 6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
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
            if (audio) {
              audio.pause();
              audio.removeAttribute("src");
              audio.load();
            }
            isPlaying.set(false);
            currentTrack.set(null);
            playQueue.set(null);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div class="bp-player-scrub">
        <span class="bp-player-time">{formatTime(playhead)}</span>
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
                  // biome-ignore lint/suspicious/noArrayIndexKey: bar N is bar N
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
            aria-valuetext={`${formatTime(playhead)} of ${formatTime(duration)}`}
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
        <span class="bp-player-time">{formatTime(duration)}</span>
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
          showMixer={sources !== null && stemCount >= MIN_MIXER_STEMS}
          queue={queue}
          onPick={playIndex}
          onPrevious={goPrevious}
          onNext={goNext}
          onToggle={togglePlayback}
          playing={playing}
          canNext={hasNext(queue)}
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

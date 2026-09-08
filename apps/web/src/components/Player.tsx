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
import { useEffect, useRef } from "preact/hooks";
import { decidePlayerClickAction } from "../client/player-actions.js";
import {
  AUDIO_SOURCE_ATTR,
  type PlayerTrack,
  audioUrl,
  currentTrack,
  isPlaying,
} from "../client/player-store.js";

interface SourceButtonData {
  takeId: string;
  assetId: string;
  title: string;
  subtitle: string;
  sourceLabel: string;
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
    sourceLabel: el.dataset.sourceLabel ?? "Master",
    role: el.dataset.role ?? "toggle",
  };
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
      el.setAttribute("aria-label", `${isActivePlaying ? "Pause" : "Play"} ${data.title}`);
    }
  }
}

export default function Player() {
  const track = useStore(currentTrack);
  const playing = useStore(isPlaying);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  // A source switch on the take already playing must preserve
  // `currentTime` — `loadedmetadata` for the NEW source is the first
  // point `currentTime` can be legally set, so the seek (and any pending
  // resume) is applied there instead of immediately after `audio.src = `.
  const pendingSeekRef = useRef<number | null>(null);
  const pendingAutoplayRef = useRef(false);

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
    const onEnded = () => isPlaying.set(false);
    const onLoadedMetadata = () => {
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
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, []);

  // The delegated click handler — the one piece of JS every play/solo
  // control on the site actually depends on. Registered once; this
  // component is never unmounted mid-session (see the header comment), so
  // there's no re-binding-after-navigation problem the way a
  // page-scoped script would have.
  useEffect(() => {
    function onClick(event: MouseEvent) {
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
        case "start-track":
          pendingSeekRef.current = null;
          pendingAutoplayRef.current = false;
          currentTrack.set(action.track);
          audio.src = audioUrl(action.track.sourceAssetId);
          // No pending seek to wait for — start playing immediately.
          // `.play()` itself invokes the resource-selection/load algorithm
          // per spec (same as the `.load()` calls above), so this does not
          // need to wait for `loadedmetadata` the way a preserved-position
          // switch does.
          void audio.play();
          break;
      }
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

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
    const applyHeight = () => {
      const height = playerEl.getBoundingClientRect().height;
      if (height <= 0) {
        return;
      }
      const shell = document.querySelector<HTMLElement>(".bp-shell");
      shell?.style.setProperty("--bp-player-height", `${height}px`);
    };
    const observer = new ResizeObserver(applyHeight);
    observer.observe(playerEl);
    document.addEventListener("astro:page-load", applyHeight);
    applyHeight();
    return () => {
      observer.disconnect();
      document.removeEventListener("astro:page-load", applyHeight);
    };
  }, []);

  const announced =
    track && track.sourceLabel !== "Master"
      ? `Now playing: ${track.title} — ${track.sourceLabel}`
      : track
        ? `Now playing: ${track.title}`
        : "";

  return (
    <div class="bp-player" hidden={!track} data-testid="bp-player" ref={playerRef}>
      {/* Track-change-only announcements — never touched by a timeupdate
          handler (there isn't one), which is what keeps this from
          spamming a screen reader on every second of playback. */}
      <p class="sr-only" aria-live="polite">
        {announced}
      </p>
      <div class="bp-player-meta">
        <span class="bp-player-title">{track?.title ?? ""}</span>
        {/* The player subtitle is the one place a meta line genuinely has to
            stay inline — there is no room for columns and no room for labels.
            So it takes the third meta-line treatment from
            docs/design-foundation.md: a 1px rule drawn between fields rather
            than a separator character. `.bp-player-sep` is aria-hidden so the
            fields read as separate phrases rather than as one run-on string. */}
        <span class="bp-player-subtitle">
          {(track
            ? [track.subtitle, track.sourceLabel !== "Master" ? track.sourceLabel : null].filter(
                (part): part is string => Boolean(part),
              )
            : []
          ).map((part, i) => (
            // Keyed on the part itself: the list is at most two entries, both
            // distinct strings (a take label and a source label), so the value
            // is a stable identity. An index key would be wrong the moment the
            // subtitle changes but the source label does not.
            <Fragment key={part}>
              {i > 0 && <span class="bp-player-sep" aria-hidden="true" />}
              {part}
            </Fragment>
          ))}
        </span>
      </div>
      {/* Native controls deliberately, not a custom seek bar: keyboard
          operability, per-control labelling, and correct Range-seek
          behavior all come from the platform for free — the exact
          category of thing this project's past a11y/contrast defects
          came from hand-rolling (see task-7-report.md). Always present in
          the DOM (never conditionally rendered) for assistive tech, per
          the brief — only the surrounding chrome's visibility toggles via
          the `hidden` attribute above. */}
      {/* biome-ignore lint/a11y/useMediaCaption: a captions track has no meaningful content for a band's own instrumental/vocal recordings — there's no dialogue to transcribe */}
      <audio ref={audioRef} controls preload="none" class="bp-player-audio" />
    </div>
  );
}

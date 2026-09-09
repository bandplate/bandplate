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
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { decidePlayerClickAction } from "../client/player-actions.js";
import {
  AUDIO_SOURCE_ATTR,
  type PlayerSource,
  type PlayerTrack,
  audioUrl,
  currentTrack,
  isPlaying,
  peaksUrl,
  sourcesUrl,
} from "../client/player-store.js";

/** How many bars the waveform draws, whatever the source's own resolution. Fixed rather than measured: the bars are `flex: 1 1 0`, so the browser divides whatever width the bar has, and a resize needs no JS at all. */
const WAVEFORM_BARS = 120;
/** What the skip controls move by. Not a preference — "play that bit again" is the move this app is for, and there is no queue to skip through. */
const SKIP_SECONDS = 10;

/** mm:ss. Chivo's tabular figures (see `.bp-player-time`) keep it from shifting as it ticks. */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Reduce a peaks file to the bar count we draw, taking the MAX of each
 * bucket rather than the mean: a waveform is about where the loud parts
 * are, and averaging flattens exactly the transients that make one
 * recognisable. Values are 0..1 already; anything outside is clamped
 * rather than trusted, since this is a file from object storage.
 */
function downsample(peaks: number[], bars: number): number[] {
  if (peaks.length === 0) {
    return [];
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = Math.floor((i * peaks.length) / bars);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / bars));
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      const v = peaks[j] ?? 0;
      if (v > max) {
        max = v;
      }
    }
    out.push(Math.max(0, Math.min(1, max)));
  }
  return out;
}

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

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  // `null` means "not fetched or none exists" — both render the plain rail,
  // and deliberately so: a take with no waveform is not an error state, it
  // is every take until something computes peaks.
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [sources, setSources] = useState<PlayerSource[] | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);

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
    const onTime = () => setPosition(audio.currentTime);
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
      .then((body: { peaks?: unknown } | null) => {
        if (cancelled) {
          return;
        }
        const raw = body?.peaks;
        setPeaks(
          Array.isArray(raw) && raw.every((v) => typeof v === "number")
            ? downsample(raw as number[], WAVEFORM_BARS)
            : null,
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
  useEffect(() => {
    if (!switcherOpen || !takeId) {
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
  }, [switcherOpen, takeId]);

  // A switch belongs to the take it was opened on; changing take closes it,
  // and so does Escape or a click anywhere else.
  useEffect(() => {
    setSwitcherOpen(false);
    setSources(null);
  }, [takeId]);
  useEffect(() => {
    if (!switcherOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSwitcherOpen(false);
      }
    };
    const onDown = (event: MouseEvent) => {
      const el = event.target;
      if (el instanceof Element && !el.closest(".bp-player-switch")) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [switcherOpen]);

  const seekBy = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) {
      return;
    }
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
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

  const bars = peaks ?? [];
  const progress = duration > 0 ? position / duration : 0;
  // The source label without its "Solo: " prefix — the chip has a caret and
  // names a source; the prefix would be a third thing on screen saying so.
  const sourceName = track ? track.sourceLabel.replace(/^Solo:\s*/, "") : "";

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
          <button
            type="button"
            class="bp-player-skip"
            onClick={() => seekBy(-SKIP_SECONDS)}
            aria-label={`Back ${SKIP_SECONDS} seconds`}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M11 5.5L4.5 12l6.5 6.5" />
              <path d="M19.5 5.5L13 12l6.5 6.5" />
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
            aria-label={playing ? `Pause ${track?.title ?? ""}` : `Play ${track?.title ?? ""}`}
            onClick={() => {
              const audio = audioRef.current;
              if (!audio) {
                return;
              }
              if (audio.paused) {
                void audio.play();
              } else {
                audio.pause();
              }
            }}
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
          <button
            type="button"
            class="bp-player-skip"
            onClick={() => seekBy(SKIP_SECONDS)}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M13 5.5L19.5 12 13 18.5" />
              <path d="M4.5 5.5L11 12l-6.5 6.5" />
            </svg>
          </button>
        </div>

        <div class="bp-player-meta">
          <span class="bp-player-title">{track?.title ?? ""}</span>
          <span class="bp-player-subtitle">{track?.subtitle ?? ""}</span>
        </div>

        {/* Only on a take that HAS more than one source. The list loads with
            the track rather than on the press, so the control cannot vanish
            under the finger that pressed it. */}
        {track && sources !== null && sources.length > 1 && (
          <div class="bp-player-switch">
            <button
              type="button"
              class="bp-player-source-trigger"
              aria-expanded={switcherOpen}
              aria-haspopup="true"
              onClick={() => setSwitcherOpen((open) => !open)}
            >
              <span class="bp-visually-hidden">Change source, currently</span>
              {sourceName}
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {switcherOpen && (
              <div class="bp-player-sources" role="group" aria-label="Source">
                {sources.map((source) => (
                  // A plain `[data-audio-source]` control, exactly like the
                  // stems drawer on a take's own page — so switching from here
                  // runs the same `decidePlayerClickAction` path that
                  // preserves the playhead, not a second implementation of it.
                  <button
                    key={source.assetId}
                    type="button"
                    class="bp-player-source"
                    data-audio-source
                    data-take-id={track.takeId}
                    data-asset-id={source.assetId}
                    data-title={track.title}
                    data-subtitle={track.subtitle}
                    data-source-label={source.kind === "stem" ? `Solo: ${source.label}` : "Master"}
                    data-role="source-select"
                    onClick={() => setSwitcherOpen(false)}
                  >
                    {source.label}
                  </button>
                ))}
              </div>
            )}
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
          aria-label="Stop and close the player"
          onClick={() => {
            const audio = audioRef.current;
            if (audio) {
              audio.pause();
              audio.removeAttribute("src");
              audio.load();
            }
            isPlaying.set(false);
            currentTrack.set(null);
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
        <span class="bp-player-time">{formatTime(position)}</span>
        {/* The seek control is a REAL `<input type="range">`, sized over the
            drawing and visually transparent. That is what keeps everything
            the native `<audio controls>` used to give for free — keyboard
            operability, arrow-key stepping, a labelled value a screen reader
            can read — while letting us draw the waveform ourselves. The bars
            behind it are `aria-hidden` decoration; the range is the control. */}
        <span class="bp-player-track">
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
            value={position}
            disabled={duration <= 0}
            aria-label="Seek"
            aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
            onInput={(event) => {
              const audio = audioRef.current;
              const next = Number((event.currentTarget as HTMLInputElement).value);
              if (audio && Number.isFinite(next)) {
                audio.currentTime = next;
                setPosition(next);
              }
            }}
          />
        </span>
        <span class="bp-player-time">{formatTime(duration)}</span>
      </div>

      {/* No `controls`: the chrome above is ours now. Always in the DOM
          (never conditionally rendered) so the element's own playback state
          survives every track change — only the bar's visibility toggles. */}
      {/* biome-ignore lint/a11y/useMediaCaption: a captions track has no meaningful content for a band's own instrumental/vocal recordings — there's no dialogue to transcribe */}
      <audio ref={audioRef} preload="none" class="bp-player-audio" />
    </div>
  );
}

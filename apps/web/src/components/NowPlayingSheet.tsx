// The "Hraje" (now playing) sheet — opened from the player bar's title,
// holding the source choice, the mixer link and the running order.
//
// Presentational only: props in, markup out, no store reads. `Player.tsx`
// owns every piece of state this renders and every callback it fires —
// keeping it that way means this component has no idea `nanostores` exists,
// and the store-reading logic stays in exactly one place.
//
// A native `<dialog>`, opened with `showModal()` — `ConfirmDialog.tsx` is the
// house precedent, for the same reason: the backdrop, Escape, focus trapping
// and the top layer all come from the platform instead of being hand-rolled.
// `showModal()` also makes everything BEHIND the dialog inert, the player bar
// included, which is why the sheet carries its own transport as a foot row
// rather than leaving the bar's underneath.
import type { playerMessages } from "@bandplate/i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import type { PlayQueue } from "../client/player-queue.js";
import { AUDIO_SOURCE_ATTR, type PlayerSource, type PlayerTrack } from "../client/player-store.js";

export interface NowPlayingSheetProps {
  open: boolean;
  onClose: () => void;
  track: PlayerTrack;
  sources: PlayerSource[] | null;
  showMixer: boolean;
  queue: PlayQueue | null;
  onPick: (index: number) => void;
  /** The foot transport — same handlers and classes as the bar's own. */
  onPrevious: () => void;
  canPrevious: boolean;
  onNext: () => void;
  onToggle: () => void;
  playing: boolean;
  canNext: boolean;
  /** The bar's track-change announcement — spoken from here while the sheet is open. */
  announced: string;
  t: ReturnType<typeof playerMessages>;
}

export function NowPlayingSheet(props: NowPlayingSheetProps) {
  const {
    open,
    onClose,
    track,
    sources,
    showMixer,
    queue,
    onPick,
    onPrevious,
    canPrevious,
    onNext,
    onToggle,
    playing,
    canNext,
    announced,
    t,
  } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  /** Whether the order list has takes above / below its visible three — drives the fades. */
  const [more, setMore] = useState({ above: false, below: false });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // The order list shows three takes and scrolls the rest. On open, and
  // whenever the queue moves, bring the current take into that window, then
  // recompute whether anything is hidden below it (the fade says so).
  const queueIndex = queue?.index ?? -1;
  const queueLength = queue?.items.length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: queueIndex/queueLength are triggers: the list's DOM is what is read.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    list.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
    updateMore(list);
  }, [open, queueIndex, queueLength]);

  function updateMore(list: HTMLElement) {
    setMore({
      above: list.scrollTop > 1,
      below: list.scrollTop + list.clientHeight < list.scrollHeight - 1,
    });
  }

  const position =
    queue && queue.items.length > 1
      ? t.position({ current: queue.index + 1, total: queue.items.length })
      : "";

  return (
    // The click below only detects a press OUTSIDE the dialog's own content
    // (the backdrop) — Escape (native `<dialog>` cancel) is the keyboard path
    // that closes it, same as the dedicated close button.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see comment above
    <dialog
      ref={ref}
      class="bp-now-playing"
      aria-labelledby="bp-now-playing-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself. So
        // would a click on the dialog's own padding or the gaps between its
        // sections, which is why the dialog has neither: they live on the
        // body div below, and everything inside the sheet lands there or
        // deeper. What is left on the dialog box is its 1px border.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div class="bp-now-playing-body">
        {/* The bar's live region is inert behind `showModal()`, so an
          auto-advance would go unannounced while this is open. Rendered
          only while open, so exactly one live region can speak at a time. */}
        {open && (
          <p class="sr-only" aria-live="polite">
            {announced}
          </p>
        )}
        <div class="bp-now-playing-head">
          <div class="bp-now-playing-heading">
            <span class="bp-eyebrow">
              {[t.nowPlayingHeading, position].filter(Boolean).join(" · ")}
            </span>
            <h2 id="bp-now-playing-title" class="bp-now-playing-title">
              {track.title}
            </h2>
            <span class="bp-now-playing-sub">{track.subtitle}</span>
          </div>
          <button type="button" class="bp-player-skip" aria-label={t.closeSheet} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M6 9l6 6 6-6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>

        {sources && sources.length > 1 && (
          <section class="bp-now-playing-section" aria-labelledby="bp-now-playing-source">
            <h3 id="bp-now-playing-source" class="bp-eyebrow bp-m0">
              {t.sourceHeading}
            </h3>
            <div class="bp-now-playing-sources">
              {sources.map((source) => {
                // Rendered here, not left to `syncButtons`: the pills mount
                // when the source list arrives, after the store change that
                // last synced the page. The attributes stay `[data-audio-source]`
                // so the player's delegated click handler still does the switch.
                const selected = source.assetId === track.sourceAssetId;
                return (
                  <button
                    key={source.assetId}
                    type="button"
                    class={`bp-now-playing-source${selected ? " is-active" : ""}`}
                    aria-pressed={selected ? "true" : "false"}
                    {...{ [AUDIO_SOURCE_ATTR]: "" }}
                    data-take-id={track.takeId}
                    data-asset-id={source.assetId}
                    data-title={track.title}
                    data-subtitle={track.subtitle}
                    data-source-kind={source.kind}
                    data-source-name={source.kind === "stem" ? source.label : ""}
                    data-role="source-select"
                  >
                    {source.label}
                  </button>
                );
              })}
            </div>
            {showMixer && (
              // `data-astro-reload` is load-bearing here for the same reason it
              // was on the bar's own mixer chip: this island is
              // `transition:persist`, so a view transition would carry THIS
              // PLAYING `<audio>` into the page that builds its own audio graph
              // — two engines, one pair of ears. A real document load cannot.
              <a href={`/takes/${track.takeId}/mix`} class="bp-now-playing-mixer" data-astro-reload>
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 3v6M6 15v6M12 3v10M12 19v2M18 3v2M18 11v10" />
                  <path d="M3 12h6M9 16h6M15 8h6" />
                </svg>
                {t.openInMixer}
              </a>
            )}
          </section>
        )}

        {queue && queue.items.length > 1 && (
          <section
            class="bp-now-playing-section bp-now-playing-order"
            aria-labelledby="bp-now-playing-order"
          >
            <h3 id="bp-now-playing-order" class="bp-eyebrow bp-m0">
              {t.orderHeading}
            </h3>
            <ol
              ref={listRef}
              class={`bp-now-playing-list${more.above ? " has-more-above" : ""}${more.below ? " has-more-below" : ""}`}
              onScroll={(event) => updateMore(event.currentTarget)}
            >
              {queue.items.map((item, i) => (
                <li key={item.takeId}>
                  <button
                    type="button"
                    class="bp-now-playing-item"
                    aria-current={i === queue.index ? "true" : undefined}
                    data-played={i < queue.index ? "" : undefined}
                    onClick={() => onPick(i)}
                  >
                    <span class="bp-now-playing-num" aria-hidden="true">
                      {i === queue.index ? (
                        <svg
                          class={`bp-now-playing-eq${playing ? " is-playing" : ""}`}
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <rect x="4" y="10" width="3" height="8" />
                          <rect x="10.5" y="5" width="3" height="13" />
                          <rect x="17" y="13" width="3" height="5" />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span class="bp-now-playing-item-text">
                      <span class="bp-now-playing-item-title">{item.title}</span>
                      <span class="bp-now-playing-item-sub">{item.subtitle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* The sheet's own transport. `showModal()` makes the bar behind it
          inert, so seeking stays on the bar (no second waveform here) but
          previous/play-pause/next have to be reachable from inside the top
          layer — same classes, same handlers as the bar's own. */}
        <div class="bp-now-playing-foot">
          <button
            type="button"
            class="bp-player-skip"
            data-player-prev
            disabled={!canPrevious}
            onClick={onPrevious}
            aria-label={t.previous}
          >
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
          <button
            type="button"
            class="bp-player-play"
            aria-pressed={playing}
            aria-label={playing ? t.pause(track.title) : t.play(track.title)}
            onClick={onToggle}
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
            data-player-next
            disabled={!canNext}
            onClick={onNext}
            aria-label={t.next}
          >
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
        </div>
      </div>
    </dialog>
  );
}

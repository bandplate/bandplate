// Recordings this device is still holding, above the server's stash rows, and
// the ones it handed over while this view was open. Rendered from IndexedDB
// (via the store the sync runner fills), so a recording made in a tunnel is
// listed the moment the stash opens, with "Čeká na signál" until it has gone
// up.
//
// EVERY row here plays, from the frame it is first drawn. The file is on this
// phone — for a moment it is the only copy of it anywhere — so there is
// nothing to wait for: the island makes an object URL per row and hands it to
// the player as `data-audio-src` (see `PlayerTrack.src`). It owns those URLs
// and revokes them, either when the row goes or, if the player is on one at
// the time, when the player moves off it.
//
// When an upload finishes the row does NOT go away and the page is NOT
// reloaded: `syncedStash` hands the row the take's real id and its bytes, so
// it keeps playing and gains the recording's own page. The next server render
// of the stash replaces it with the server's row, which plays the same audio
// from the bucket.
//
// The row is `StashRow.astro`'s markup, written again because Astro and Preact
// cannot share a component. Same classes, so the styling lives once; change
// one, change both.
//
// A recording the server refused gets its way out here: "Zkusit znovu" only
// where another attempt can succeed (`canRetryByHand`), and always "Zahodit",
// behind a confirm, because throwing it away is the one thing that loses it.
import {
  type Locale,
  formatDuration,
  formatShortDate,
  playerMessages,
  stashMessages,
} from "@bandplate/i18n";
import { useStore } from "@nanostores/preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";
import { currentTrack } from "../client/player-store.js";
import { stashName, stashNote } from "../client/stash-display.js";
import { pendingStash, syncedStash } from "../client/stash-store.js";
import {
  type LocalStashRow,
  type PendingSummary,
  canRetryByHand,
  localPlayId,
  localStashRows,
} from "../client/stash-sync-logic.js";
import {
  discardPending,
  discardPendingForTake,
  pendingBlob,
  refreshPendingStash,
  retryPending,
} from "../client/stash-sync.js";

interface Props {
  locale: Locale;
  /**
   * The signed-in member. A shared browser holds other members' recordings
   * too; those are not drawn, so they cannot be discarded from here either.
   */
  memberId: string;
  /** The server rows on this page — a recording already among them is not drawn twice. */
  serverTakeIds: string[];
  /**
   * The take just deleted (`?deleted=`). A local copy still waiting to upload
   * into it is dropped from this device.
   */
  deletedTakeId?: string | undefined;
}

const TRASH_PATH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";

/**
 * Hands an object URL back. Immediately, unless the player is on it — audio
 * in this app plays across navigation, and revoking the URL under a playing
 * `<audio>` would cut the recording off mid-bar. Then it goes when the player
 * moves to something else.
 */
function releaseObjectUrl(url: string): void {
  if (currentTrack.get()?.src !== url) {
    URL.revokeObjectURL(url);
    return;
  }
  const stop = currentTrack.listen((track) => {
    if (track?.src !== url) {
      stop();
      URL.revokeObjectURL(url);
    }
  });
}

/** `PlayToggleButton.astro`'s markup, for the same reason the row is: change one, change both. */
function PlayToggle({
  playId,
  url,
  title,
  subtitle,
  label,
}: {
  playId: string;
  url: string;
  title: string;
  subtitle: string;
  label: string;
}) {
  return (
    <button
      type="button"
      class="bp-play-toggle"
      data-audio-source
      data-take-id={playId}
      // The player names a source by its asset id, and this recording has no
      // asset anywhere yet: it carries its own id, and the URL beside it says
      // where the audio actually is.
      data-asset-id={playId}
      data-audio-src={url}
      data-title={title}
      data-subtitle={subtitle}
      data-source-kind="master"
      data-role="toggle"
      aria-pressed="false"
      aria-label={label}
    >
      <svg
        class="bp-play-icon-play"
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M4 2.5v11l10-5.5-10-5.5z" />
      </svg>
      <svg
        class="bp-play-icon-pause"
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" />
      </svg>
    </button>
  );
}

export default function StashPendingList({
  locale,
  memberId,
  serverTakeIds,
  deletedTakeId,
}: Props) {
  const lc = currentLocale(locale);
  const t = stashMessages(lc);
  const player = playerMessages(lc);
  const pending = useStore(pendingStash);
  const synced = useStore(syncedStash);
  // The server cannot see IndexedDB, so it renders as if nothing were pending.
  // The first render in the browser has to say the same, or hydration finds
  // rows the server never sent (the sync runner has usually filled the store
  // by then). The local rows arrive one render later.
  const [mounted, setMounted] = useState(false);
  const [discarding, setDiscarding] = useState<PendingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  /** localId -> object URL. The ref is the truth; the state is what re-renders. */
  const urlsRef = useRef(new Map<string, string>());
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    setMounted(true);
    if (deletedTakeId) {
      void discardPendingForTake(deletedTakeId);
    } else {
      void refreshPendingStash();
    }
  }, [deletedTakeId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (discarding && !dialog.open) {
      dialog.showModal();
    } else if (!discarding && dialog.open) {
      dialog.close();
    }
  }, [discarding]);

  async function confirmDiscard() {
    if (!discarding) {
      return;
    }
    setBusy(true);
    try {
      await discardPending(discarding.localId);
    } finally {
      setBusy(false);
      setDiscarding(null);
    }
  }

  const rows: LocalStashRow[] = mounted
    ? localStashRows(
        pending,
        synced.map((item) => item.row),
        memberId,
        new Set(serverTakeIds),
        new Set(deletedTakeId ? [deletedTakeId] : []),
      )
    : [];

  // One object URL per row, made once the row exists and dropped when it does
  // not. A recording that has just finished uploading brings its bytes with
  // it, so there is no moment where the file is neither in IndexedDB nor in
  // hand.
  const rowIds = rows.map((entry) => entry.row.localId).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the row ids are the trigger; the rows and the blobs are re-read inside
  useEffect(() => {
    let cancelled = false;
    const live = new Set(rows.map((entry) => entry.row.localId));
    const held = urlsRef.current;
    let changed = false;

    for (const [localId, url] of [...held]) {
      if (!live.has(localId)) {
        held.delete(localId);
        releaseObjectUrl(url);
        changed = true;
      }
    }
    for (const item of synced) {
      if (live.has(item.row.localId) && !held.has(item.row.localId)) {
        held.set(item.row.localId, URL.createObjectURL(item.blob));
        changed = true;
      }
    }
    if (changed) {
      setUrls(new Map(held));
    }

    // IndexedDB is the slow half, so it goes last and it is guarded: the rows
    // may have moved on by the time the bytes arrive.
    void (async () => {
      for (const entry of rows) {
        const { localId } = entry.row;
        if (held.has(localId)) {
          continue;
        }
        const blob = await pendingBlob(localId);
        if (cancelled || !blob || held.has(localId)) {
          continue;
        }
        held.set(localId, URL.createObjectURL(blob));
        setUrls(new Map(held));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rowIds]);

  // The page is leaving. Nothing is drawn from these URLs any more, and the
  // one the player may still be on outlives this list by exactly as long as
  // it is playing.
  useEffect(() => {
    const held = urlsRef.current;
    return () => {
      for (const url of held.values()) {
        releaseObjectUrl(url);
      }
      held.clear();
    };
  }, []);

  const chip = (row: PendingSummary): string =>
    row.status === "failed"
      ? t.chipFailed
      : row.status === "syncing"
        ? t.chipSyncing
        : t.chipWaiting;

  // The dialog is always rendered, so opening it never changes the tree the
  // rows sit in; with nothing to discard it is an empty, closed `<dialog>`.
  const dialog = (
    <dialog
      ref={dialogRef}
      class="bp-dialog"
      aria-modal="true"
      aria-labelledby="bp-stash-discard-title"
      onClose={() => setDiscarding(null)}
      onCancel={() => setDiscarding(null)}
    >
      {discarding && (
        <>
          <h2 id="bp-stash-discard-title">{t.discardQuestion}</h2>
          <p>{t.discardPendingBody}</p>
          <div class="bp-dialog-actions">
            <button
              type="button"
              class="bp-btn bp-btn-secondary"
              onClick={() => setDiscarding(null)}
              disabled={busy}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              class="bp-btn bp-btn-danger"
              onClick={() => void confirmDiscard()}
              disabled={busy}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={TRASH_PATH} />
              </svg>
              {t.discard}
            </button>
          </div>
        </>
      )}
    </dialog>
  );

  if (rows.length === 0) {
    return (
      <>
        {serverTakeIds.length === 0 && (
          <div class="bp-empty-state">
            <p>{t.empty}</p>
          </div>
        )}
        {dialog}
      </>
    );
  }

  const nameWords = { noSong: t.noSongYet, unknownSong: t.unknownSong };

  return (
    <>
      <div class="bp-take-list bp-take-list--wide" data-play-queue>
        {rows.map((entry) => {
          const { row } = entry;
          // The recording's own name leads, the song goes under it; see
          // `stashName`.
          const nameParts = { songId: row.songId, songTitle: row.songTitle, label: row.label };
          const title = stashName(nameParts, nameWords);
          const note = stashNote(nameParts, nameWords);
          const date = formatShortDate(lc, row.recordedAt);
          const url = urls.get(row.localId);
          // A recording the server now has has a page of its own, and its own
          // sheet on the next render; one still on the phone has neither, so
          // its name is text rather than a link that goes nowhere.
          const heading: ComponentChildren =
            entry.kind === "synced" ? (
              <a href={`/stash/${entry.row.takeId}`} class="bp-take-label">
                {title}
              </a>
            ) : (
              <span class="bp-stash-pending-title">{title}</span>
            );
          return (
            <div class="bp-take-row bp-stash-row" key={row.localId}>
              <div class="bp-take-row-lead">
                {url ? (
                  <PlayToggle
                    playId={localPlayId(row.localId)}
                    url={url}
                    title={title}
                    subtitle={note ?? date}
                    label={player.play(title)}
                  />
                ) : (
                  <span class="bp-take-plate" aria-hidden="true" />
                )}
              </div>
              <div class="bp-take-row-line">
                <span class="bp-take-row-name">{heading}</span>
              </div>
              <span class="bp-take-row-duration">{formatDuration(row.durationMs)}</span>
              <div class="bp-take-line2">
                <span class="bp-take-textrun">
                  {entry.kind === "pending" && (
                    <span
                      class={
                        row.status === "failed"
                          ? "bp-badge bp-stash-chip is-failed"
                          : "bp-badge bp-stash-chip"
                      }
                    >
                      {row.status === "waiting" && (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="m2 2 20 20M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.19M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10 5.07" />
                        </svg>
                      )}
                      {chip(row)}
                    </span>
                  )}
                  {note && (
                    <>
                      <span class="bp-take-note bp-take-elastic">{note}</span>
                      <span class="bp-take-rule" />
                    </>
                  )}
                  <span class="bp-take-fixed">{date}</span>
                </span>
              </div>
              {/* A line of its own, under the facts: on a phone, line two cannot
                hold the chip, the label, the date AND two buttons. */}
              {entry.kind === "pending" && row.status === "failed" && (
                <div class="bp-stash-row-actions">
                  {canRetryByHand(row) && (
                    <button
                      type="button"
                      class="bp-btn bp-btn-secondary bp-btn-sm"
                      onClick={() => void retryPending(row.localId)}
                    >
                      {t.retry}
                    </button>
                  )}
                  <button
                    type="button"
                    class="bp-btn bp-btn-danger bp-btn-sm"
                    onClick={() => setDiscarding(row)}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d={TRASH_PATH} />
                    </svg>
                    {t.discard}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {dialog}
    </>
  );
}

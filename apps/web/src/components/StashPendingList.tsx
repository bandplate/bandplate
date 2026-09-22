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
// and revokes them: when the row goes, when the page is swapped out from
// under the list (`astro:before-swap`, since the router never unmounts an
// island and a Preact cleanup would never run), or — if the player is on one
// at the time — when the player moves off it.
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
  formatDuration,
  formatShortDate,
  type Locale,
  playerMessages,
  stashMessages,
} from "@bandplate/i18n";
import { useStore } from "@nanostores/preact";
import { CloudOff, Pause, Play, Trash } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";
import { queueHoldsSource } from "../client/player-queue.js";
import { currentTrack, playQueue } from "../client/player-store.js";
import { stashName, stashNote } from "../client/stash-display.js";
import { stashSheetId } from "../client/stash-sheet-ids.js";
import { createStashSheets, type StashSheets } from "../client/stash-sheets.js";
import { currentMember, pendingStash, syncedStash } from "../client/stash-store.js";
import {
  discardPending,
  discardPendingForTake,
  pendingBlob,
  refreshPendingStash,
  retryPending,
} from "../client/stash-sync.js";
import {
  canRetryByHand,
  type LocalStashRow,
  localPlayId,
  localStashRows,
  type PendingSummary,
} from "../client/stash-sync-logic.js";

interface Props {
  locale: Locale;
  /**
   * The signed-in member, AS OF THIS PAGE'S OWN SERVER RENDER. A shared
   * browser holds other members' recordings too; those are not drawn, so
   * they cannot be discarded from here either.
   *
   * Only the fallback for the render before `stash-sync.ts`'s own
   * `currentMember` store has a value (effectively never, in practice — see
   * below) and for a document with no script at all. The live render always
   * prefers that store: `<ClientRouter />` never unmounts this island, and a
   * member switch signalled from another tab (`member-signal.ts`) must hide
   * the old member's rows here without this tab navigating.
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

/**
 * Whether revoking this URL would break playback. Not just the track playing
 * now: the queue this row was started from holds the rows AFTER it too, and
 * auto-advancing into a revoked URL loads nothing and looks like a track that
 * silently ends the queue.
 */
function urlInUse(url: string): boolean {
  return currentTrack.get()?.src === url || queueHoldsSource(playQueue.get(), url);
}

/**
 * Hands an object URL back. Immediately, unless the player still needs it —
 * audio in this app plays across navigation, and revoking under a playing
 * `<audio>` cuts the recording off mid-bar. Then it goes at the first track
 * change that leaves it unused, which is also when a queue holding it is
 * replaced by another list.
 */
function releaseObjectUrl(url: string): void {
  if (!urlInUse(url)) {
    URL.revokeObjectURL(url);
    return;
  }
  const stop = currentTrack.listen(() => {
    if (!urlInUse(url)) {
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
      <Play size={18} class="bp-play-icon-play" aria-hidden="true" fill="currentColor" />
      <Pause size={18} class="bp-play-icon-pause" aria-hidden="true" fill="currentColor" />
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
  // `startStashSync` sets this before any island hydrates, on every full
  // load; the `memberId` prop is the fallback for the sliver of time (if
  // any) before that, and for a document with no script. `undefined` is
  // "not set yet" — `null` is a real answer ("nobody signed in", from a
  // sign-out signal) and must NOT fall back to the stale prop, or a member
  // switch signalled from another tab would keep showing the old member's
  // rows. See `currentMember`'s own comment in `stash-store.ts`.
  const liveMemberId = useStore(currentMember);
  const effectiveMemberId = liveMemberId === undefined ? memberId : liveMemberId;
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
  /**
   * The sheets THIS island fetched. Per instance, never per module: the router
   * leaves a retired island alive (see below), and a module-level set would let
   * its cleanup remove a server-rendered sheet of the same id from the page
   * that is actually up.
   */
  const sheetsRef = useRef<StashSheets | null>(null);
  if (sheetsRef.current === null) {
    sheetsRef.current = createStashSheets();
  }
  /**
   * The page this island was drawn on has been swapped out. `<ClientRouter />`
   * never unmounts an island, so nothing else would ever say so, and a retired
   * island that kept making object URLs for a detached list would hold every
   * recording's bytes for the rest of the session.
   */
  const retiredRef = useRef(false);

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
        effectiveMemberId,
        new Set(serverTakeIds),
        new Set(deletedTakeId ? [deletedTakeId] : []),
      )
    : [];

  // One object URL per row, made once the row exists and dropped when it does
  // not. A recording that has just finished uploading brings its bytes with
  // it, so there is no moment where the file is neither in IndexedDB nor in
  // hand.
  // The KIND is part of the key: a pending row whose blob could not be read
  // (IndexedDB refused, or the sync runner was mid-write) becomes a synced row
  // with its bytes in hand, and that row must get its URL then rather than
  // staying inert until something else changes.
  const rowIds = rows.map((entry) => `${entry.kind}:${entry.row.localId}`).join(" ");
  useEffect(() => {
    if (retiredRef.current) {
      return;
    }
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

  // A recording that went up while this view was open has a page and a sheet
  // on the server now, and the page it is being drawn on was rendered before
  // either existed. Fetch them in, so the row the member just made opens what
  // every other row opens.
  const syncedTakeIds = rows
    .flatMap((entry) => (entry.kind === "synced" ? [entry.row.takeId] : []))
    .join(" ");
  // One fetch for all of them: the response is the whole stash view either way.
  useEffect(() => {
    if (syncedTakeIds === "" || retiredRef.current) {
      return;
    }
    void sheetsRef.current?.ensure(syncedTakeIds.split(" "));
  }, [syncedTakeIds]);

  // The page is leaving. `astro:before-swap`, not a Preact cleanup: the router
  // swaps the body without unmounting islands (see AppLayout), so the cleanup
  // this used to be never ran — which made the ownership claim above false and
  // left every object URL held for the life of the tab.
  //
  // The sheets this island fetched go with the page, and so do the URLs —
  // except the one the player may still be on, which outlives this list by
  // exactly as long as it is needed.
  useEffect(() => {
    const held = urlsRef.current;
    const sheets = sheetsRef.current;
    function retire() {
      retiredRef.current = true;
      for (const url of held.values()) {
        releaseObjectUrl(url);
      }
      held.clear();
      setUrls(new Map());
      sheets?.drop();
    }
    document.addEventListener("astro:before-swap", retire);
    return () => document.removeEventListener("astro:before-swap", retire);
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
              <Trash aria-hidden="true" />
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
          // `data-sheet-open` whether or not the sheet has arrived: the
          // handler leaves a trigger whose sheet is missing alone, and the
          // link then does what it says and opens the page.
          const heading: ComponentChildren =
            entry.kind === "synced" ? (
              <a
                href={`/stash/${entry.row.takeId}`}
                class="bp-take-label"
                data-sheet-open={stashSheetId(entry.row.takeId)}
              >
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
                      {row.status === "waiting" && <CloudOff aria-hidden="true" />}
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
                    <Trash aria-hidden="true" />
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

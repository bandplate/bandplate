// Recordings still on this device, above the server's stash rows. Rendered
// from IndexedDB (via the store the sync runner fills), so a recording made in
// a tunnel is listed the moment the stash opens, with "Čeká na signál" until
// it has gone up. When an upload finishes the page reloads, and the server row
// takes over.
//
// The row is `StashRow.astro`'s markup, written again because Astro and Preact
// cannot share a component. Same classes, so the styling lives once; change
// one, change both.
//
// A recording the server refused gets its way out here: "Zkusit znovu" only
// where another attempt can succeed (`canRetryByHand`), and always "Zahodit",
// behind a confirm, because throwing it away is the one thing that loses it.
import { type Locale, formatDuration, formatShortDate, stashMessages } from "@bandplate/i18n";
import { useStore } from "@nanostores/preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";
import { pendingStash, stashUploadsFinished } from "../client/stash-store.js";
import {
  type PendingSummary,
  canRetryByHand,
  pendingToRender,
} from "../client/stash-sync-logic.js";
import {
  discardPending,
  discardPendingForTake,
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
   * The take just deleted on `/stash/[id]` (`?deleted=`). A local copy still
   * waiting to upload into it is dropped from this device.
   */
  deletedTakeId?: string | undefined;
}

const TRASH_PATH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";

export default function StashPendingList({
  locale,
  memberId,
  serverTakeIds,
  deletedTakeId,
}: Props) {
  const lc = currentLocale(locale);
  const t = stashMessages(lc);
  const pending = useStore(pendingStash);
  const finished = useStore(stashUploadsFinished);
  const finishedAtMount = useRef(finished);
  // The server cannot see IndexedDB, so it renders as if nothing were pending.
  // The first render in the browser has to say the same, or hydration finds
  // rows the server never sent (the sync runner has usually filled the store
  // by then). The local rows arrive one render later.
  const [mounted, setMounted] = useState(false);
  const [discarding, setDiscarding] = useState<PendingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setMounted(true);
    if (deletedTakeId) {
      void discardPendingForTake(deletedTakeId);
    } else {
      void refreshPendingStash();
    }
  }, [deletedTakeId]);

  useEffect(() => {
    if (finished !== finishedAtMount.current) {
      // `replace`, not `reload`: this document may be a POST response.
      window.location.replace(window.location.href);
    }
  }, [finished]);

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

  const rows = mounted
    ? pendingToRender(
        pending,
        memberId,
        new Set(serverTakeIds),
        new Set(deletedTakeId ? [deletedTakeId] : []),
      )
    : [];

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

  return (
    <>
      <div class="bp-take-list bp-take-list--wide">
        {rows.map((row) => (
          <div class="bp-take-row bp-stash-row" key={row.localId}>
            <div class="bp-take-row-lead">
              <span class="bp-take-plate" aria-hidden="true" />
            </div>
            <div class="bp-take-row-line">
              <span class="bp-take-row-name">
                {/* Not `.bp-take-label`: that one stretches a link over the whole
                    row, and this row has no page yet — and buttons of its own. */}
                <span class="bp-stash-pending-title">{row.songTitle}</span>
              </span>
            </div>
            <span class="bp-take-row-duration">{formatDuration(row.durationMs)}</span>
            <div class="bp-take-line2">
              <span class="bp-take-textrun">
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
                {row.label && (
                  <>
                    <span class="bp-take-note bp-take-elastic">{row.label}</span>
                    <span class="bp-take-rule" />
                  </>
                )}
                <span class="bp-take-fixed">{formatShortDate(lc, row.recordedAt)}</span>
              </span>
            </div>
            {/* A line of its own, under the facts: on a phone, line two cannot
                hold the chip, the label, the date AND two buttons. */}
            {row.status === "failed" && (
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
        ))}
      </div>
      {dialog}
    </>
  );
}

// The offline queue's decisions. A recording is saved to IndexedDB FIRST and
// uploaded whenever there is signal; this module decides what the next step
// for one recording is, and what a failure means. `stash-sync.ts` does the
// fetching and the IndexedDB writes.
//
// The one promise all of it serves: a recording is never deleted from the
// phone until the server has confirmed the file arrived whole. Giving up only
// ever stops AUTOMATIC retries; the blob stays until the member acts.
import type { RecordedFormat } from "./recorder-logic.js";

export type PendingStatus =
  /** Nothing in flight; the next sync takes it. */
  | "waiting"
  /** A sync is working on it right now (or was, when the tab closed). */
  | "syncing"
  /** The server refused it in a way retrying will not fix. Kept; retried only by hand. */
  | "failed";

export interface PendingStashItem {
  /** IndexedDB key, and the take's `clientRef` on the server. */
  localId: string;
  songId: string;
  /** Kept locally so the stash can name a recording with no signal at all. */
  songTitle: string;
  label: string | null;
  /** Wall clock at the start of the recording. */
  recordedAt: number;
  durationMs: number;
  mime: string;
  format: RecordedFormat;
  bytes: number;
  /** Set once the server has created the take — the upload goes into it. */
  takeId: string | null;
  status: PendingStatus;
  attempts: number;
  lastError: string | null;
  blob: Blob;
}

/** What the list renders and the store holds: never the bytes. */
export type PendingSummary = Omit<PendingStashItem, "blob">;

export interface NewPendingInput {
  localId: string;
  songId: string;
  songTitle: string;
  label: string | null;
  recordedAt: number;
  durationMs: number;
  mime: string;
  format: RecordedFormat;
  blob: Blob;
}

export function newPendingItem(input: NewPendingInput): PendingStashItem {
  return {
    ...input,
    bytes: input.blob.size,
    takeId: null,
    status: "waiting",
    attempts: 0,
    lastError: null,
  };
}

export function summarize(item: PendingStashItem): PendingSummary {
  const { blob: _blob, ...rest } = item;
  return rest;
}

export type SyncStep = "create" | "upload";

export function nextSyncStep(item: Pick<PendingSummary, "takeId">): SyncStep {
  return item.takeId ? "upload" : "create";
}

export function shouldSync(item: Pick<PendingSummary, "status">): boolean {
  return item.status !== "failed";
}

export type Failure = { network: true } | { status: number };
export type FailureKind = "retry" | "give-up";

/**
 * Retry what time fixes; stop on what it will not.
 *
 * 401/403 are RETRY: a session that expired on the bus comes back when the
 * member next signs in, and a presigned URL that expired is re-signed by the
 * next declare. 404 (the song was deleted), 409 and 422 will answer the same
 * way forever.
 */
export function classifyFailure(failure: Failure): FailureKind {
  if ("network" in failure) {
    return "retry";
  }
  const { status } = failure;
  if (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  ) {
    return "retry";
  }
  return "give-up";
}

export function afterFailure<T extends PendingSummary>(
  item: T,
  kind: FailureKind,
  message: string,
): T {
  return {
    ...item,
    status: kind === "retry" ? "waiting" : "failed",
    attempts: item.attempts + 1,
    lastError: message,
  };
}

export function retryItem<T extends PendingSummary>(item: T): T {
  return { ...item, status: "waiting", lastError: null };
}

/**
 * The local rows the stash view should draw, newest first.
 *
 * A recording whose take the server already created is ALSO a server row on
 * the same page (with its own "Čeká na signál" chip until the file lands), so
 * drawing it here too would show it twice.
 */
export function pendingToRender(
  items: PendingSummary[],
  serverTakeIds: ReadonlySet<string>,
): PendingSummary[] {
  return items
    .filter((item) => !(item.takeId && serverTakeIds.has(item.takeId)))
    .sort((a, b) => b.recordedAt - a.recordedAt);
}

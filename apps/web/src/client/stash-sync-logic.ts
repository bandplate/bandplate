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

/** The request a sync attempt was making when it failed. */
export type SyncRequest = "create" | "declare" | "put" | "verify";

/** Where a sync attempt stopped, and what the other end answered. */
export interface FailurePoint {
  request: SyncRequest;
  status: number;
}

export interface PendingStashItem {
  /** IndexedDB key, and the take's `clientRef` on the server. */
  localId: string;
  /**
   * The member who recorded it. A shared browser holds several members'
   * queues in one IndexedDB, and each member syncs, sees and discards only
   * their own. Optional: records saved before it existed have none, and
   * `ownedBy` treats those as nobody's.
   */
  memberId?: string | null;
  /**
   * The song this is for, or NULL for a recording whose member has not decided
   * yet. Optional: records saved before the song could be skipped always have
   * one, and a missing field reads the same as NULL.
   */
  songId?: string | null;
  /** Kept locally so the stash can name a recording with no signal at all. */
  songTitle?: string | null;
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
  /**
   * Where the last attempt failed, so the stash can tell a failure a retry
   * can fix from one it cannot. Optional: records saved before it existed
   * have none, and `canRetryByHand` treats those as it always did.
   */
  failedAt?: FailurePoint | null;
  blob: Blob;
}

/** What the list renders and the store holds: never the bytes. */
export type PendingSummary = Omit<PendingStashItem, "blob">;

export interface NewPendingInput {
  localId: string;
  memberId: string;
  songId: string | null;
  songTitle: string | null;
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
    failedAt: null,
  };
}

export function summarize(item: PendingStashItem): PendingSummary {
  const { blob: _blob, ...rest } = item;
  return rest;
}

/**
 * Whether this recording is the signed-in member's. A record with no member
 * (saved before the field existed) is nobody's: syncing it would put it into
 * whoever happens to be signed in, so it is left exactly where it is.
 */
export function ownedBy(
  item: Pick<PendingSummary, "memberId">,
  memberId: string | null | undefined,
): boolean {
  return Boolean(memberId) && item.memberId === memberId;
}

/** Only the signed-in member's recordings; every other one is left alone. */
export function ownPending<T extends Pick<PendingSummary, "memberId">>(
  items: T[],
  memberId: string | null | undefined,
): T[] {
  return items.filter((item) => ownedBy(item, memberId));
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
  failedAt: FailurePoint | null = null,
): T {
  return {
    ...item,
    status: kind === "retry" ? "waiting" : "failed",
    attempts: item.attempts + 1,
    lastError: message,
    failedAt,
  };
}

export function retryItem<T extends PendingSummary>(item: T): T {
  return { ...item, status: "waiting", lastError: null, failedAt: null };
}

/**
 * Whether "Zkusit znovu" can do anything for a recording that was given up on.
 *
 * Only where the next attempt is a DIFFERENT attempt: the bucket refused this
 * upload (the next declare signs a new one, and S3 answers a stalled socket
 * with 400), or the server found the file had not arrived whole. Everything
 * else that gives up answers the same way forever: 404 is a deleted song or a
 * deleted take, and 422 is a request the server will never accept. A retry
 * button on those would be a control that cannot work, so the row offers
 * only to throw the recording away.
 *
 * A failure saved before the request was recorded keeps its retry: nothing is
 * known about it, and it is what that row offered before.
 */
export function canRetryByHand(item: Pick<PendingSummary, "status" | "failedAt">): boolean {
  if (item.status !== "failed") {
    return false;
  }
  const at = item.failedAt;
  if (!at) {
    return true;
  }
  return at.request === "put" || (at.request === "verify" && at.status === 409);
}

/** The local copies of one server take, for when that take has been deleted. */
export function pendingForTake(
  items: Pick<PendingSummary, "localId" | "takeId">[],
  takeId: string,
): string[] {
  return items.filter((item) => item.takeId === takeId).map((item) => item.localId);
}

/**
 * The player identity of a row this island draws.
 *
 * Its OWN id, never the take's, and it keeps it after the upload lands: the
 * player is told which take is loaded by whatever started it, and a row that
 * renamed itself mid-playback would stop showing as the one playing. The
 * server's row for the same take carries the take id and is a different row
 * — which is correct, because it plays a different URL.
 */
export function localPlayId(localId: string): string {
  return `stash-local:${localId}`;
}

/** A recording the server now has, still drawn by the island that queued it. */
export type SyncedSummary = PendingSummary & { takeId: string };

/**
 * Which handed-over rows belong to the render that is on screen.
 *
 * A row the sync runner hands over belongs to exactly ONE page render: the one
 * that was up when the upload landed, which the server drew before the take
 * existed. `pageSeq` is that render, counted up on every navigation.
 *
 * It has to go at the next render, and "is it still in the server's list?"
 * cannot decide that: a take the new page does not list is either one the
 * render predates (keep) or one that has LEFT the stash — added to a song, or
 * deleted (drop). Those look identical from the ids alone, and guessing wrong
 * is the bug this exists for: a published recording drawn as a stash row for
 * the rest of the session, with a name that 404s through `/stash/<id>`. The
 * render it belongs to is the fact that tells them apart.
 *
 * So nothing outlives its render. What the next one draws is the server's own
 * row, which is the truth about where that recording now lives.
 */
export function syncedForRender<T extends { pageSeq: number }>(items: T[], pageSeq: number): T[] {
  return items.filter((item) => item.pageSeq === pageSeq);
}

/**
 * One row the stash view's island draws: a recording still waiting to go up,
 * or one that went up while this view was open and has not been through a
 * server render yet. Both play from the bytes on this device.
 */
export type LocalStashRow =
  | { kind: "pending"; row: PendingSummary }
  | { kind: "synced"; row: SyncedSummary };

/**
 * Every row the island draws, newest first — the two kinds in ONE order,
 * because to a member they are one list of their own recordings and an upload
 * finishing must not make a row jump.
 *
 * Same exclusions throughout: another member's recording on a shared device,
 * a take the server already drew on this page, and a take just deleted (whose
 * local copies are on their way out of IndexedDB) are none of them drawn.
 */
export function localStashRows(
  pending: PendingSummary[],
  synced: SyncedSummary[],
  memberId: string | null,
  serverTakeIds: ReadonlySet<string>,
  deletedTakeIds: ReadonlySet<string> = new Set(),
): LocalStashRow[] {
  const gone = (takeId: string | null): boolean =>
    takeId !== null && (serverTakeIds.has(takeId) || deletedTakeIds.has(takeId));
  // The sync runner deletes the local copy and hands the row over in one step,
  // but the pending store is only re-read once the whole run is done. Between
  // the two it still lists a recording that is already somebody else's row.
  const handedOver = new Set(synced.map((row) => row.localId));
  const rows: LocalStashRow[] = [
    ...ownPending(pending, memberId)
      .filter((row) => !gone(row.takeId) && !handedOver.has(row.localId))
      .map((row): LocalStashRow => ({ kind: "pending", row })),
    ...ownPending(synced, memberId)
      .filter((row) => !gone(row.takeId))
      .map((row): LocalStashRow => ({ kind: "synced", row })),
  ];
  return rows.sort((a, b) => b.row.recordedAt - a.row.recordedAt);
}

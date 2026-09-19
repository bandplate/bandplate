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
 * The local rows the stash view should draw, newest first.
 *
 * A recording whose take the server already created is ALSO a server row on
 * the same page (with its own "Čeká na signál" chip until the file lands), so
 * drawing it here too would show it twice.
 */
export function pendingToRender(
  items: PendingSummary[],
  /** The signed-in member. Another member's recordings on this device are not drawn. */
  memberId: string | null,
  serverTakeIds: ReadonlySet<string>,
  /**
   * Takes just deleted from this page. Their local copies are on their way
   * out of IndexedDB, and must not flash back as rows meanwhile.
   */
  deletedTakeIds: ReadonlySet<string> = new Set(),
): PendingSummary[] {
  return ownPending(items, memberId)
    .filter(
      (item) =>
        !(item.takeId && (serverTakeIds.has(item.takeId) || deletedTakeIds.has(item.takeId))),
    )
    .sort((a, b) => b.recordedAt - a.recordedAt);
}

// Moves recordings from this device to the server, one at a time, whenever
// there is a chance: on every full page load (`startStashSync` from
// AppLayout), on the `online` event, and when the stash view asks.
//
// Per recording: create the take (idempotent on the local id, so a lost
// response costs nothing), then declare → PUT → verify exactly as the upload
// panel does, then delete the local copy. The local copy goes ONLY after
// verify says the object arrived whole.
//
// A shared browser keeps every member's recordings in the one IndexedDB. The
// runner works only on the signed-in member's (`ownPending`): another
// member's are not uploaded, not listed and not discarded, and a record from
// before the member was stored belongs to no one and is left alone.
import { deletePending, getPending, listPending, putPending } from "./stash-db.js";
import { pendingStash, syncedStash } from "./stash-store.js";
import {
  type PendingStashItem,
  type SyncRequest,
  afterFailure,
  canRetryByHand,
  classifyFailure,
  nextSyncStep,
  ownPending,
  ownedBy,
  pendingForTake,
  retryItem,
  shouldSync,
  summarize,
  syncedForRender,
} from "./stash-sync-logic.js";

const LOCK_NAME = "bandplate-stash-sync";

/** Who is signed in on this document; set once by `startStashSync`. */
let currentMemberId: string | null = null;

/**
 * Which page render is on screen, counted up on every navigation.
 *
 * `<ClientRouter />` swaps the body and never unmounts an island, so this
 * module outlives every page that uses it — which is why a row handed over on
 * one render must be stamped with that render and dropped at the next. See
 * `syncedForRender` for what goes wrong without it.
 */
let pageSeq = 0;

/** This member's recordings on this device, bytes and all. */
async function listOwnPending(): Promise<PendingStashItem[]> {
  return ownPending(await listPending(), currentMemberId);
}

class HttpFailure extends Error {
  constructor(
    readonly request: SyncRequest,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function failureOf(request: SyncRequest, res: Response): Promise<HttpFailure> {
  const body = await res.json().catch(() => null);
  return new HttpFailure(request, res.status, body?.error?.message ?? `HTTP ${res.status}`);
}

export async function refreshPendingStash(): Promise<void> {
  try {
    pendingStash.set((await listOwnPending()).map(summarize));
  } catch {
    // No IndexedDB (a locked-down private window): nothing can be pending.
    pendingStash.set([]);
  }
}

/**
 * The bytes of one of this member's pending recordings, so the stash view can
 * play it while it is still on its way up. Another member's recording on a
 * shared device is not handed out, exactly as it is not listed or synced.
 */
export async function pendingBlob(localId: string): Promise<Blob | null> {
  try {
    const item = await getPending(localId);
    return item && ownedBy(item, currentMemberId) ? item.blob : null;
  } catch {
    // No IndexedDB: nothing is pending, so there is nothing to play.
    return null;
  }
}

async function save(item: PendingStashItem): Promise<void> {
  await putPending(item);
  await refreshPendingStash();
}

async function uploadMaster(item: PendingStashItem): Promise<void> {
  const declared = await postJson(`/api/takes/${item.takeId}/assets`, {
    kind: "master",
    tier: "lossy",
    format: item.format,
    bytes: item.bytes,
    durationMs: item.durationMs,
    // A stash take has exactly one file, and a pending slot here is always an
    // earlier attempt at THIS recording — replacing it is the retry.
    replace: true,
  });
  if (!declared.ok) {
    throw await failureOf("declare", declared);
  }
  const slot = (await declared.json()) as {
    assetId: string;
    url: string;
    headers: Record<string, string>;
  };

  // fetch, not XHR: nobody watches a progress bar for a background retry.
  const put = await fetch(slot.url, { method: "PUT", headers: slot.headers, body: item.blob });
  if (!put.ok) {
    throw new HttpFailure("put", put.status, `The bucket answered ${put.status}.`);
  }

  const verified = await postJson(`/api/assets/${slot.assetId}/verify`, {
    durationMs: item.durationMs,
  });
  if (!verified.ok) {
    throw await failureOf("verify", verified);
  }
}

/**
 * The local copy goes, and the row it was drawn as stays: the take's id and
 * the bytes are handed to the store, so the stash view can keep drawing and
 * playing that recording without fetching the page again. See `syncedStash`.
 */
async function finish(item: PendingStashItem): Promise<void> {
  const takeId = item.takeId;
  await deletePending(item.localId);
  if (takeId) {
    syncedStash.set([
      ...syncedStash.get().filter((done) => done.row.localId !== item.localId),
      { row: { ...summarize(item), takeId }, blob: item.blob, pageSeq },
    ]);
  }
}

async function syncOne(item: PendingStashItem): Promise<void> {
  let current: PendingStashItem = { ...item, status: "syncing" };
  await save(current);
  try {
    if (nextSyncStep(current) === "create") {
      const res = await postJson("/api/stash/takes", {
        clientRef: current.localId,
        songId: current.songId,
        label: current.label,
        recordedAt: current.recordedAt,
        durationMs: current.durationMs,
      });
      if (!res.ok) {
        throw await failureOf("create", res);
      }
      const body = (await res.json()) as { takeId: string; masterReady: boolean };
      current = { ...current, takeId: body.takeId };
      await save(current);
      if (body.masterReady) {
        await finish(current);
        return;
      }
    }
    await uploadMaster(current);
    await finish(current);
  } catch (err) {
    const failure =
      err instanceof HttpFailure ? { status: err.status } : { network: true as const };
    const message = err instanceof Error ? err.message : String(err);
    const failedAt =
      err instanceof HttpFailure ? { request: err.request, status: err.status } : null;
    await save(afterFailure(current, classifyFailure(failure), message, failedAt));
  }
}

async function runOnce(): Promise<void> {
  let items: PendingStashItem[];
  try {
    items = await listOwnPending();
  } catch {
    pendingStash.set([]);
    return;
  }
  pendingStash.set(items.map(summarize));
  for (const item of items) {
    if (shouldSync(item)) {
      await syncOne(item);
    }
  }
  await refreshPendingStash();
}

let running: Promise<void> | null = null;

/**
 * One sync at a time per tab (the promise is shared), and one per browser when
 * the Web Locks API exists — two tabs uploading the same recording would not
 * corrupt anything (every step is idempotent), but it would upload it twice.
 */
export function syncPendingStash(): Promise<void> {
  if (running) {
    return running;
  }
  const task = async () => {
    if ("locks" in navigator) {
      await navigator.locks.request(LOCK_NAME, () => runOnce());
    } else {
      await runOnce();
    }
  };
  running = task().finally(() => {
    running = null;
  });
  return running;
}

/** The "Zkusit znovu" button on a recording the server refused. */
export async function retryPending(localId: string): Promise<void> {
  const item = (await listOwnPending()).find((i) => i.localId === localId);
  if (item && canRetryByHand(item)) {
    await save(retryItem(item));
    await syncPendingStash();
  }
}

/**
 * Runs `fn` when no sync is touching the queue: after this tab's own sync,
 * and under the same Web Lock as every tab's. A delete that raced a sync
 * would be undone by the sync's next `putPending` of the item it holds.
 */
async function exclusive(fn: () => Promise<void>): Promise<void> {
  await running?.catch(() => undefined);
  if ("locks" in navigator) {
    await navigator.locks.request(LOCK_NAME, fn);
  } else {
    await fn();
  }
}

/**
 * "Zahodit" on a recording that cannot be uploaded: the one place a local
 * copy goes without the server having confirmed it. Only the member's own
 * press, after a confirm, reaches this.
 */
export async function discardPending(localId: string): Promise<void> {
  await exclusive(async () => {
    const item = (await listPending()).find((i) => i.localId === localId);
    if (item && ownedBy(item, currentMemberId)) {
      await deletePending(localId);
    }
  });
  await refreshPendingStash();
}

/**
 * The owner deleted this take on `/stash/[id]`. A local copy still waiting to
 * upload into it would otherwise come back as a row whose upload 404s forever.
 */
export async function discardPendingForTake(takeId: string): Promise<void> {
  await exclusive(async () => {
    for (const localId of pendingForTake(await listOwnPending(), takeId)) {
      await deletePending(localId);
    }
  });
  // A copy that finished uploading into this take while the view was open is
  // drawn from the store rather than from IndexedDB, and the take it points at
  // is gone.
  syncedStash.set(syncedStash.get().filter((done) => done.row.takeId !== takeId));
  await refreshPendingStash();
}

let started = false;

/**
 * Called once per document from AppLayout, with the signed-in member. Without
 * one nothing is synced: every recording on the device is somebody else's.
 */
export function startStashSync(memberId: string | null): void {
  if (started || typeof window === "undefined") {
    return;
  }
  started = true;
  currentMemberId = memberId || null;
  // A navigation is the moment the server gets to say where every recording
  // now lives, so it is where a handed-over row's render ends. `before-swap`
  // rather than `page-load`: it fires on navigations only (never on the first
  // load, which needs no clearing), and it fires before the new page's island
  // draws anything.
  document.addEventListener("astro:before-swap", () => {
    pageSeq += 1;
    syncedStash.set(syncedForRender(syncedStash.get(), pageSeq));
  });
  window.addEventListener("online", () => {
    void syncPendingStash();
  });
  void syncPendingStash();
}

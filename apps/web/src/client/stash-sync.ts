// Moves recordings from this device to the server, one at a time, whenever
// there is a chance: on every full page load (`startStashSync` from
// AppLayout), on the `online` event, and when the stash view asks.
//
// Per recording: create the take (idempotent on the local id, so a lost
// response costs nothing), then declare → PUT → verify exactly as the upload
// panel does, then delete the local copy. The local copy goes ONLY after
// verify says the object arrived whole.
import { deletePending, listPending, putPending } from "./stash-db.js";
import { pendingStash, stashUploadsFinished } from "./stash-store.js";
import {
  type PendingStashItem,
  afterFailure,
  classifyFailure,
  nextSyncStep,
  retryItem,
  shouldSync,
  summarize,
} from "./stash-sync-logic.js";

class HttpFailure extends Error {
  constructor(
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

async function failureOf(res: Response): Promise<HttpFailure> {
  const body = await res.json().catch(() => null);
  return new HttpFailure(res.status, body?.error?.message ?? `HTTP ${res.status}`);
}

export async function refreshPendingStash(): Promise<void> {
  try {
    pendingStash.set((await listPending()).map(summarize));
  } catch {
    // No IndexedDB (a locked-down private window): nothing can be pending.
    pendingStash.set([]);
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
    throw await failureOf(declared);
  }
  const slot = (await declared.json()) as {
    assetId: string;
    url: string;
    headers: Record<string, string>;
  };

  // fetch, not XHR: nobody watches a progress bar for a background retry.
  const put = await fetch(slot.url, { method: "PUT", headers: slot.headers, body: item.blob });
  if (!put.ok) {
    throw new HttpFailure(put.status, `The bucket answered ${put.status}.`);
  }

  const verified = await postJson(`/api/assets/${slot.assetId}/verify`, {
    durationMs: item.durationMs,
  });
  if (!verified.ok) {
    throw await failureOf(verified);
  }
}

async function finish(item: PendingStashItem): Promise<void> {
  await deletePending(item.localId);
  stashUploadsFinished.set(stashUploadsFinished.get() + 1);
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
        throw await failureOf(res);
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
    await save(afterFailure(current, classifyFailure(failure), message));
  }
}

async function runOnce(): Promise<void> {
  let items: PendingStashItem[];
  try {
    items = await listPending();
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
      await navigator.locks.request("bandplate-stash-sync", () => runOnce());
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
  const item = (await listPending()).find((i) => i.localId === localId);
  if (item) {
    await save(retryItem(item));
    await syncPendingStash();
  }
}

let started = false;

/** Called once per document from AppLayout. */
export function startStashSync(): void {
  if (started || typeof window === "undefined") {
    return;
  }
  started = true;
  window.addEventListener("online", () => {
    void syncPendingStash();
  });
  void syncPendingStash();
}

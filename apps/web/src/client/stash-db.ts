// The smallest IndexedDB wrapper that does the job: one store, keyed by the
// recording's local id, holding the Blob itself (IndexedDB stores Blobs
// natively, Safari included, so nothing is base64'd or chunked).
//
// Every function opens, does one transaction, and closes. A recording is
// written once and read a handful of times; a long-lived connection would buy
// nothing and would block a future version upgrade in another tab.
import type { PendingStashItem } from "./stash-sync-logic.js";

const DB_NAME = "bandplate-stash";
const DB_VERSION = 1;
const STORE = "pending";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    const tx = db.transaction(STORE, mode);
    const result = await request(run(tx.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

export async function putPending(item: PendingStashItem): Promise<void> {
  await withStore("readwrite", (store) => store.put(item));
}

/** One recording with its bytes — what the stash view plays before the upload lands. */
export async function getPending(localId: string): Promise<PendingStashItem | undefined> {
  return withStore("readonly", (store) => store.get(localId) as IDBRequest<PendingStashItem>);
}

export async function listPending(): Promise<PendingStashItem[]> {
  return withStore("readonly", (store) => store.getAll() as IDBRequest<PendingStashItem[]>);
}

export async function deletePending(localId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(localId));
}

// What the stash view shows of the local queue, and a counter it watches to
// know when to reload. nanostores for the same reason `player-store.ts` uses
// it: the sync runner is a plain module, the list is an island, and they meet
// here.
import { atom } from "nanostores";
import type { PendingSummary } from "./stash-sync-logic.js";

/** Every recording still on this device, without the bytes. */
export const pendingStash = atom<PendingSummary[]>([]);

/**
 * Bumped each time an upload is verified and its local copy deleted. The stash
 * view reloads on it, so the server row (now playable) replaces the chip.
 */
export const stashUploadsFinished = atom(0);

// What the stash view shows of the local queue, and what it shows of a queue
// that has just emptied. nanostores for the same reason `player-store.ts` uses
// it: the sync runner is a plain module, the list is an island, and they meet
// here.
import { atom } from "nanostores";
import type { PendingSummary } from "./stash-sync-logic.js";

/** Every recording still on this device, without the bytes. */
export const pendingStash = atom<PendingSummary[]>([]);

/**
 * Who `stash-sync.ts` currently believes is signed in — `undefined` until
 * `startStashSync` has run once, then `null` or a member id, kept live by the
 * cross-tab member signal (see `member-signal.ts`).
 *
 * `undefined` is its own state, DELIBERATELY distinct from `null` ("nobody is
 * signed in", a real answer once a sign-out signal has landed): a shared
 * browser's pending list island is handed the signed-in member as a
 * server-rendered prop, which is only as fresh as this tab's last navigation,
 * and `StashPendingList` falls back to that prop only while this store has
 * never been set. Collapsing the two into one `null` was the bug this comment
 * replaces — `liveMemberId ?? prop` treated "signed out" exactly like
 * "unknown yet" and fell back to the stale prop, which is precisely the
 * member switch this store exists to catch.
 */
export const currentMember = atom<string | null | undefined>(undefined);

/**
 * One recording the server now has, handed over at the moment its local copy
 * was deleted.
 *
 * The bytes come with it, and that is the point: the member is looking at the
 * row, possibly playing it, and the page cannot grow a server row without
 * being fetched again. So the row stays where it is, gains the take's real id
 * (it has a page now, and a sheet on the next render) and keeps playing from
 * the blob it was already playing from. The next full render of the stash is
 * what replaces it with the server's own row — and the row does not outlive
 * that render, whether or not the server still calls the recording a stash
 * one. See `syncedForRender`.
 */
export interface SyncedStashItem {
  row: PendingSummary & { takeId: string };
  blob: Blob;
  /**
   * The page render this row belongs to. It is drawn only while that render is
   * on screen; the next one asks the server, which knows whether the recording
   * is still in the stash. See `syncedForRender`.
   */
  pageSeq: number;
}

/** Recordings that went up while this stash view was open, newest write last. */
export const syncedStash = atom<SyncedStashItem[]>([]);

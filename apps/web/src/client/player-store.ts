// The persistent player's state — nanostores (~1KB), not a framework
// store, specifically so both `.astro` pages (plain markup + a data-*
// attribute contract, no hydration of their own) and the one Preact
// island (`Player.tsx`) can share it. See Player.tsx's header comment for
// the full mechanism: this module only holds the state, never touches the
// DOM.
//
// Browser-only despite living in a plain .ts module with no Node/DOM
// dependency of its own (nanostores itself is isomorphic) — nothing here
// requires that, it's just never imported from server code.
import { atom } from "nanostores";

/** A play/solo control's persistent identity, in one place — every element wired up to the player (TakeRow's leading slot, the take-detail hero, the stems drawer) carries these as `data-*` attributes with these exact names, read by `Player.tsx`'s delegated click handler. */
export const AUDIO_SOURCE_ATTR = "data-audio-source";

export interface PlayerTrack {
  takeId: string;
  /** Song title (or a fallback label) — never changes across a source switch on the same take. */
  title: string;
  /** Event/date context, or the take's own label. Empty string when there is none. */
  subtitle: string;
  /** The asset id of the currently selected source (the master, or one stem). */
  sourceAssetId: string;
  /** "Master" or "Solo: <instrument>" — announced alongside the title on every source switch, since that IS a track change from a listening (and accessibility) standpoint. */
  sourceLabel: string;
}

/** `null` when nothing has ever been played this session. */
export const currentTrack = atom<PlayerTrack | null>(null);
export const isPlaying = atom<boolean>(false);

export function audioUrl(assetId: string): string {
  return `/api/assets/${assetId}/audio`;
}

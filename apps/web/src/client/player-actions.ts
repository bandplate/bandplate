// The player's click-decision logic, pulled out of `Player.tsx` as a pure
// function specifically so it's unit-testable without a DOM/audio element
// at all (see `player-actions.test.ts`) — `Player.tsx` itself only has to
// carry out whichever `PlayerClickAction` this returns (mutate `audio.src`,
// set `audio.currentTime`, call `.play()`), not decide what to do.
//
// The three cases, in order of precedence:
//   1. The clicked control is exactly what's already loaded -> a plain
//      play/pause toggle. No source change, no position change.
//   2. The clicked control is a DIFFERENT source on the SAME take (a
//      master <-> stem switch from the Solo drawer, or the take-detail
//      hero's own button while a stem is soloed) -> switch source,
//      preserving `currentTime` and the current playing/paused state —
//      this is the brief's "switches the source while preserving
//      currentTime" requirement.
//   3. Anything else is a different take entirely -> start it from 0:00,
//      autoplaying (the click IS the user's play gesture).
import type { PlayerTrack } from "./player-store.js";

export interface ClickedSource {
  takeId: string;
  assetId: string;
  title: string;
  subtitle: string;
  sourceLabel: string;
}

export type PlayerClickAction =
  | { kind: "toggle-playback" }
  | { kind: "switch-source"; track: PlayerTrack; preservePosition: true }
  | { kind: "start-track"; track: PlayerTrack };

export function decidePlayerClickAction(
  active: PlayerTrack | null,
  clicked: ClickedSource,
): PlayerClickAction {
  if (active && active.takeId === clicked.takeId && active.sourceAssetId === clicked.assetId) {
    return { kind: "toggle-playback" };
  }

  if (active && active.takeId === clicked.takeId) {
    return {
      kind: "switch-source",
      track: {
        ...active,
        sourceAssetId: clicked.assetId,
        sourceLabel: clicked.sourceLabel,
      },
      preservePosition: true,
    };
  }

  return {
    kind: "start-track",
    track: {
      takeId: clicked.takeId,
      title: clicked.title,
      subtitle: clicked.subtitle,
      sourceAssetId: clicked.assetId,
      sourceLabel: clicked.sourceLabel,
    },
  };
}

// The player's click-decision logic, pulled out of `Player.tsx` as a pure
// function specifically so it's unit-testable without a DOM/audio element
// at all (see `player-actions.test.ts`) — `Player.tsx` itself only has to
// carry out whichever `PlayerClickAction` this returns (mutate `audio.src`,
// set `audio.currentTime`, call `.play()`), not decide what to do.
//
// The four cases, in order of precedence:
//   1. A source-SELECT control (the Hraje sheet's source pills) for the
//      source that's already selected -> no-op. Re-clicking a selector for
//      what's already selected pausing playback would be surprising;
//      selecting isn't toggling (review: fix round 1, item 12).
//   2. A plain play/pause toggle for the take already loaded -> a plain
//      play/pause toggle, WHICHEVER of its sources is playing. A row's
//      toggle always carries the master, but while a stem of that take
//      plays it shows as playing (see `controlState`), so pressing it has
//      to do what it says: pause. Swapping back to the master is the
//      sheet's job, where the sources are named.
//   3. A source-select control for a different source on the SAME take
//      (a master <-> stem switch from the sheet) -> switch source,
//      preserving `currentTime` and the current playing/paused state.
//   4. Anything else is a different take entirely -> start it from 0:00,
//      autoplaying (the click IS the user's play gesture).
import type { PlayerTrack } from "./player-store.js";

export interface ClickedSource {
  takeId: string;
  assetId: string;
  title: string;
  subtitle: string;
  sourceKind: "master" | "stem";
  sourceName: string;
  /** "source-select" (the Hraje sheet's source pills) vs. the default "toggle" play/pause control — see the module comment, case 1. */
  role: string;
}

export type PlayerClickAction =
  | { kind: "noop" }
  | { kind: "toggle-playback" }
  | { kind: "switch-source"; track: PlayerTrack; preservePosition: true }
  | { kind: "start-track"; track: PlayerTrack };

export function decidePlayerClickAction(
  active: PlayerTrack | null,
  clicked: ClickedSource,
): PlayerClickAction {
  if (active && active.takeId === clicked.takeId) {
    if (clicked.role !== "source-select") {
      return { kind: "toggle-playback" };
    }
    if (active.sourceAssetId === clicked.assetId) {
      return { kind: "noop" };
    }
  }

  if (active && active.takeId === clicked.takeId) {
    return {
      kind: "switch-source",
      track: {
        ...active,
        sourceAssetId: clicked.assetId,
        sourceKind: clicked.sourceKind,
        sourceName: clicked.sourceName,
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
      sourceKind: clicked.sourceKind,
      sourceName: clicked.sourceName,
    },
  };
}

/** What one on-page control should show for the player's current state. */
export interface ControlState {
  /** `aria-pressed`. */
  pressed: boolean;
  /** `.is-active`: this exact source is the one loaded. */
  selected: boolean;
  /** `.is-current-take`: the take is the one loaded, whichever source. */
  currentTake: boolean;
  /** `.is-playing`, and for a toggle the "Pause" label. */
  playing: boolean;
}

/**
 * `aria-pressed` means different things for the two roles: a source-select
 * pill is a SELECTOR, so pressed is "this source is the selected one", paused
 * or not (a paused-but-selected pill announcing as unpressed would be
 * indistinguishable from an unselected one; review: fix round 1, item 3). A
 * plain toggle is play/pause, keyed on the TAKE: a row's toggle carries the
 * master, and while one of that take's stems plays, pressing it pauses the
 * take (case 2 above), so it reads as playing too.
 */
export function controlState(
  active: PlayerTrack | null,
  playing: boolean,
  control: { takeId: string; assetId: string; role: string },
): ControlState {
  const currentTake = active !== null && active.takeId === control.takeId;
  const selected = currentTake && active.sourceAssetId === control.assetId;
  if (control.role === "source-select") {
    return { pressed: selected, selected, currentTake, playing: selected && playing };
  }
  const takePlaying = currentTake && playing;
  return { pressed: takePlaying, selected, currentTake, playing: takePlaying };
}

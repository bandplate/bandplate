// What the recorder's screens show for a phase, and when leaving costs audio.
//
// `recorder-logic.ts` is the state machine itself (pick -> armed -> starting
// -> recording -> finishing -> review -> saving). This module reads a phase
// and answers the questions `Recorder.tsx` used to answer inline: is the
// microphone live, would leaving lose a recording, what the stage's × and its
// big round button are, which confirm is up, and why getUserMedia failed.
// The component still owns the dialogs, the microphone and navigation; it
// asks here what they should be doing.
import type { RecorderError, RecorderPhase, RecorderState } from "./recorder-logic.js";

/**
 * Why the microphone was not granted, from the thrown `DOMException`'s name
 * (`""` for anything that was not one). A refusal and a missing device say
 * different things to the member; everything else is "this browser cannot".
 */
export function micErrorFromName(name: string): RecorderError {
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "no-mic";
  }
  return "unsupported";
}

/**
 * The microphone is live. `confirm-discard` counts: the question "throw it
 * away?" is asked over a recording that carries on until it is answered, so
 * the clock ticks, the wake lock is held and Stop still stops.
 */
export function isCapturing(phase: RecorderPhase): boolean {
  return phase === "recording" || phase === "confirm-discard";
}

/**
 * Leaving the page now would lose audio, so the browser's own "leave page?"
 * guards it. Not `saving`: that phase leaves for the stash by itself the
 * moment the write lands.
 */
export function hasUnsavedRecording(phase: RecorderPhase): boolean {
  return isCapturing(phase) || phase === "review" || phase === "finishing";
}

/**
 * The stage's top-left ×.
 *
 * - `cancel`: a button that asks before throwing the live recording away.
 * - `leave`: a plain link out, before anything is recorded. `starting` too,
 *   so a permission prompt nobody answers cannot trap the member.
 * - `none`: an empty slot, while the question is already up or the take is
 *   finishing into the review.
 */
export function stageClose(phase: RecorderPhase): "cancel" | "leave" | "none" {
  if (phase === "recording") {
    return "cancel";
  }
  if (phase === "armed" || phase === "starting" || phase === "error") {
    return "leave";
  }
  return "none";
}

/** The big round button in the level ring: Stop, Start, or a busy disc with no action. */
export function stageRing(phase: RecorderPhase): "stop" | "start" | "busy" {
  if (isCapturing(phase)) {
    return "stop";
  }
  if (phase === "armed" || phase === "error") {
    return "start";
  }
  return "busy";
}

/**
 * Which confirm is showing. The stage's discard question is a phase of its
 * own, because "keep going" there means keep RECORDING. The review screen's
 * leave question is not a phase (`leaveAsked` is component state): it asks
 * about a recording that has already stopped.
 */
export function openConfirm(phase: RecorderPhase, leaveAsked: boolean): "discard" | "leave" | null {
  if (phase === "confirm-discard") {
    return "discard";
  }
  if ((phase === "review" || phase === "saving") && leaveAsked) {
    return "leave";
  }
  return null;
}

/**
 * Whether the armed stage offers a way back to the picker: only when the song
 * was not handed over with the link, and there is more than one to choose.
 */
export function canChangeSong(input: {
  phase: RecorderPhase;
  songCount: number;
  songOnLink: boolean;
}): boolean {
  return input.phase === "armed" && input.songCount > 1 && !input.songOnLink;
}

/**
 * "Zatím bez písně" is drawn pressed once it is the ANSWER. `songId: null`
 * alone also means nobody has answered yet, and drawing it pressed on first
 * paint would claim a choice the member never made.
 */
export function skipSongPressed(state: Pick<RecorderState, "songChosen" | "songId">): boolean {
  return state.songChosen && state.songId === null;
}

/** How long the take ran, from the monotonic start to `now`. Zero if it never started. */
export function durationAtStop(startedAt: number | null, now: number): number {
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

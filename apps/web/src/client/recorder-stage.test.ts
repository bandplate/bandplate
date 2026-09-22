import { describe, expect, it } from "vitest";
import { initialRecorderState, type RecorderPhase, reduceRecorder } from "./recorder-logic.js";
import {
  durationAtStop,
  hasUnsavedRecording,
  isCapturing,
  micErrorFromName,
  openConfirm,
  skipSongPressed,
  stageClose,
  stageRing,
} from "./recorder-stage.js";

const PHASES: RecorderPhase[] = [
  "pick",
  "armed",
  "starting",
  "recording",
  "confirm-discard",
  "finishing",
  "review",
  "saving",
  "error",
];

function phasesWhere(pred: (phase: RecorderPhase) => boolean): RecorderPhase[] {
  return PHASES.filter(pred);
}

describe("micErrorFromName", () => {
  it("tells a refusal from a missing microphone", () => {
    expect(micErrorFromName("NotAllowedError")).toBe("denied");
    // Chrome on an insecure origin.
    expect(micErrorFromName("SecurityError")).toBe("denied");
    expect(micErrorFromName("NotFoundError")).toBe("no-mic");
    expect(micErrorFromName("OverconstrainedError")).toBe("no-mic");
  });

  it("reads anything else, a thrown non-DOMException included, as unsupported", () => {
    expect(micErrorFromName("NotReadableError")).toBe("unsupported");
    expect(micErrorFromName("")).toBe("unsupported");
  });
});

describe("isCapturing", () => {
  it("is the microphone being live: recording, and still recording behind the discard question", () => {
    expect(phasesWhere(isCapturing)).toEqual(["recording", "confirm-discard"]);
  });
});

describe("hasUnsavedRecording", () => {
  it("guards every phase where leaving would lose audio", () => {
    // `saving` is not here: it leaves for the stash on its own the moment
    // the write lands, and must not ask.
    expect(phasesWhere(hasUnsavedRecording)).toEqual([
      "recording",
      "confirm-discard",
      "finishing",
      "review",
    ]);
  });
});

describe("stageClose", () => {
  it("asks before throwing a live recording away", () => {
    expect(stageClose("recording")).toBe("cancel");
  });

  it("is a plain way out before anything is recorded, a stuck permission prompt included", () => {
    expect(stageClose("armed")).toBe("leave");
    expect(stageClose("starting")).toBe("leave");
    expect(stageClose("error")).toBe("leave");
  });

  it("is nothing while the discard question is up or the take is finishing", () => {
    expect(stageClose("confirm-discard")).toBe("none");
    expect(stageClose("finishing")).toBe("none");
  });
});

describe("stageRing", () => {
  it("is Stop while the microphone is live", () => {
    expect(stageRing("recording")).toBe("stop");
    expect(stageRing("confirm-discard")).toBe("stop");
  });

  it("is Start where a press can start, and busy in between", () => {
    expect(stageRing("armed")).toBe("start");
    expect(stageRing("error")).toBe("start");
    expect(stageRing("starting")).toBe("busy");
    expect(stageRing("finishing")).toBe("busy");
  });
});

describe("openConfirm", () => {
  it("shows the discard question while the stage asks it", () => {
    expect(openConfirm("confirm-discard", false)).toBe("discard");
  });

  it("shows the leave question on the review screen once × was pressed", () => {
    expect(openConfirm("review", true)).toBe("leave");
    expect(openConfirm("review", false)).toBeNull();
    expect(openConfirm("saving", true)).toBe("leave");
  });

  it("shows nothing anywhere else, whatever was asked", () => {
    expect(openConfirm("recording", true)).toBeNull();
    expect(openConfirm("pick", true)).toBeNull();
  });
});

describe("skipSongPressed", () => {
  it("draws 'Zatím bez písně' pressed only once it was the answer", () => {
    const fresh = initialRecorderState(null);
    expect(skipSongPressed(fresh)).toBe(false);
    expect(skipSongPressed(reduceRecorder(fresh, { type: "select", songId: null }))).toBe(true);
    expect(skipSongPressed(reduceRecorder(fresh, { type: "select", songId: "s-1" }))).toBe(false);
  });
});

describe("durationAtStop", () => {
  it("is the time since recording began", () => {
    expect(durationAtStop(1000, 43_500)).toBe(42_500);
  });

  it("is zero for a clock that never started, or one that reads earlier than it began", () => {
    expect(durationAtStop(null, 43_500)).toBe(0);
    expect(durationAtStop(5000, 4000)).toBe(0);
  });
});

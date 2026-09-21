import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_TUNING,
  decideSync,
  INITIAL_SYNC_STATE,
  pickLeader,
  resetSyncState,
  type TrackSample,
} from "./mixer-sync.js";

const ok = (mediaTime: number): TrackSample => ({ mediaTime, ended: false, stalled: false });
const stalled = (mediaTime: number): TrackSample => ({ mediaTime, ended: false, stalled: true });
const ended = (mediaTime: number): TrackSample => ({ mediaTime, ended: true, stalled: false });
const notReady = (): TrackSample => ({ mediaTime: null, ended: false, stalled: false });

describe("pickLeader", () => {
  it("is the first track when it is healthy", () => {
    expect(pickLeader([ok(10), ok(10)])).toBe(0);
  });

  it("skips a STALLED first track", () => {
    // The probe's actual failure: the master stalled at index 0, and six
    // perfectly aligned tracks were measured against its stopped clock and
    // reported 882,551 ppm of drift.
    expect(pickLeader([stalled(2), ok(10), ok(10)])).toBe(1);
  });

  it("skips an ENDED first track — a stem may be shorter than the take", () => {
    expect(pickLeader([ended(12), ok(240)])).toBe(1);
  });

  it("skips a track that cannot report a time yet", () => {
    expect(pickLeader([notReady(), ok(10)])).toBe(1);
  });

  it("is null when nothing is healthy, rather than picking a bad reference", () => {
    expect(pickLeader([stalled(1), ended(2), notReady()])).toBeNull();
  });
});

describe("decideSync", () => {
  it("holds when the set is together", () => {
    const { decision, state } = decideSync([ok(10), ok(10.001)], INITIAL_SYNC_STATE);
    expect(decision.kind).toBe("hold");
    expect(state.breaches).toBe(0);
  });

  it("does NOT resync on a single breach — one sample can land on a clock edge", () => {
    const { decision, state } = decideSync([ok(10), ok(11)], INITIAL_SYNC_STATE);
    expect(decision.kind).toBe("hold");
    expect(state.breaches).toBe(1);
  });

  it("resyncs on two consecutive breaches", () => {
    const first = decideSync([ok(10), ok(11)], INITIAL_SYNC_STATE);
    const second = decideSync([ok(10), ok(11)], first.state);
    expect(second.decision.kind).toBe("resync");
    if (second.decision.kind === "resync") {
      expect(second.decision.targetS).toBe(10);
      expect(second.decision.leaderIndex).toBe(0);
    }
  });

  it("resets the counter on one good sample, rather than decrementing it", () => {
    // The counter asks "has this been wrong CONTINUOUSLY", and one good
    // sample answers no. Decrementing would let an intermittent wobble
    // accumulate into a stop-the-world nobody needed.
    //
    // Needs a tuning of 3 to be observable at all: at the default 2 the
    // counter never exceeds 1, so reset and decrement are the same function
    // and a test at that tuning proves nothing.
    const tuning = { resyncThresholdS: 0.15, resyncBreaches: 3 };
    const bad = [ok(10), ok(11)];
    const good = [ok(10), ok(10)];

    let state = INITIAL_SYNC_STATE;
    for (const samples of [bad, bad, good, bad, bad]) {
      const step = decideSync(samples, state, tuning);
      // Decrementing reaches 3 on the last of these and fires; resetting
      // starts again from the good sample and never does.
      expect(step.decision.kind).toBe("hold");
      state = step.state;
    }
    expect(state.breaches).toBe(2);
  });

  it("clears its own counter when it fires, so it cannot fire twice running", () => {
    const first = decideSync([ok(10), ok(11)], INITIAL_SYNC_STATE);
    const second = decideSync([ok(10), ok(11)], first.state);
    expect(second.state.breaches).toBe(0);
  });

  it("never counts an ENDED track as adrift, however far its frozen clock is", () => {
    // A twelve-second overdub sitting at 12s while the take runs to 240s is
    // not an emergency, and treating it as one is an endless resync loop.
    let state = INITIAL_SYNC_STATE;
    for (let i = 0; i < 5; i++) {
      const step = decideSync([ok(240), ended(12)], state);
      expect(step.decision.kind).toBe("hold");
      state = step.state;
    }
  });

  it("never counts a STALLED track as adrift — that is buffering, not drift", () => {
    let state = INITIAL_SYNC_STATE;
    for (let i = 0; i < 5; i++) {
      const step = decideSync([ok(240), stalled(100)], state);
      expect(step.decision.kind).toBe("hold");
      state = step.state;
    }
  });

  it("measures against the healthy leader, not against index 0", () => {
    const first = decideSync([stalled(2), ok(10), ok(11)], INITIAL_SYNC_STATE);
    const second = decideSync([stalled(2), ok(10), ok(11)], first.state);
    expect(second.decision.kind).toBe("resync");
    if (second.decision.kind === "resync") {
      expect(second.decision.leaderIndex).toBe(1);
      expect(second.decision.targetS).toBe(10);
    }
  });

  it("holds with no leader at all rather than throwing", () => {
    const { decision } = decideSync([stalled(1), notReady()], INITIAL_SYNC_STATE);
    expect(decision).toEqual({ kind: "hold", leaderIndex: null, worstErrorS: 0 });
  });

  it("reports the worst error, which is what the probe puts on screen", () => {
    const { decision } = decideSync([ok(10), ok(10.05), ok(9.9)], INITIAL_SYNC_STATE);
    expect(decision.worstErrorS).toBeCloseTo(0.1, 10);
  });

  it("does not breach just under the threshold, and does just over it", () => {
    // Deliberately not testing the exact boundary: `10 + 0.15` is not
    // 0.15 away from 10 in float64, so an equality test there measures IEEE
    // 754 rather than this module. What matters is that the threshold
    // separates the two cases.
    const under = decideSync(
      [ok(10), ok(10 + DEFAULT_SYNC_TUNING.resyncThresholdS * 0.9)],
      INITIAL_SYNC_STATE,
    );
    expect(under.state.breaches).toBe(0);

    const over = decideSync(
      [ok(10), ok(10 + DEFAULT_SYNC_TUNING.resyncThresholdS * 1.1)],
      INITIAL_SYNC_STATE,
    );
    expect(over.state.breaches).toBe(1);
  });
});

describe("resetSyncState", () => {
  it("clears the counter after a discontinuity", () => {
    expect(resetSyncState(2)).toEqual({ breaches: 0, leaderIndex: 2 });
  });
});

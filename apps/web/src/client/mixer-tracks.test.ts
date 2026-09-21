import { mixerMessages } from "@bandplate/i18n";
import { describe, expect, it } from "vitest";
import {
  clampFader,
  failureText,
  initialMixerState,
  MAX_FADER,
  type MixerState,
  setFader,
  setMuted,
  setSoloed,
  type TrackControl,
  toggleMuteMine,
  trackGains,
} from "./mixer-tracks.js";

const track = (over: Partial<TrackControl> & { assetId: string }): TrackControl => ({
  fader: 1,
  muted: false,
  soloed: false,
  mine: false,
  ...over,
});

const state = (tracks: TrackControl[], over: Partial<MixerState> = {}): MixerState => ({
  tracks,
  muteMine: false,
  presetMuted: [],
  ...over,
});

describe("trackGains", () => {
  it("passes the fader through when nothing is muted or soloed", () => {
    const gains = trackGains([track({ assetId: "a", fader: 0.6 })]);
    expect(gains.get("a")).toBe(0.6);
  });

  it("silences a muted track", () => {
    expect(trackGains([track({ assetId: "a", muted: true })]).get("a")).toBe(0);
  });

  it("silences everything NOT soloed as soon as anything is", () => {
    const gains = trackGains([
      track({ assetId: "a", soloed: true }),
      track({ assetId: "b" }),
      track({ assetId: "c" }),
    ]);
    expect(gains.get("a")).toBe(1);
    expect(gains.get("b")).toBe(0);
    expect(gains.get("c")).toBe(0);
  });

  it("lets two tracks be soloed together — the rhythm section is one thing", () => {
    const gains = trackGains([
      track({ assetId: "a", soloed: true }),
      track({ assetId: "b", soloed: true }),
      track({ assetId: "c" }),
    ]);
    expect([gains.get("a"), gains.get("b"), gains.get("c")]).toEqual([1, 1, 0]);
  });

  it("keeps mute winning on a track that is both soloed and muted", () => {
    // An explicit silence stays silent; DAWs disagree, and this is the
    // reading that never surprises the person who pressed mute.
    expect(trackGains([track({ assetId: "a", soloed: true, muted: true })]).get("a")).toBe(0);
  });

  it("clamps a fader that arrived out of range rather than trusting it", () => {
    const gains = trackGains([track({ assetId: "a", fader: 99 })]);
    expect(gains.get("a")).toBe(MAX_FADER);
  });
});

describe("clampFader", () => {
  it("floors at silence and ceilings above unity, because boosting is the point", () => {
    expect(clampFader(-1)).toBe(0);
    expect(clampFader(2)).toBe(MAX_FADER);
    expect(MAX_FADER).toBeGreaterThan(1);
  });

  it("treats NaN as silence rather than propagating it into a GainNode", () => {
    expect(clampFader(Number.NaN)).toBe(0);
  });
});

describe("toggleMuteMine", () => {
  it("mutes your instruments and nobody else's", () => {
    const next = toggleMuteMine(
      state([
        track({ assetId: "bass", mine: true }),
        track({ assetId: "gtr" }),
        track({ assetId: "master" }),
      ]),
    );
    expect(next.muteMine).toBe(true);
    expect(next.tracks.map((t) => [t.assetId, t.muted])).toEqual([
      ["bass", true],
      ["gtr", false],
      ["master", false],
    ]);
  });

  it("un-mutes exactly what it muted when released", () => {
    const engaged = toggleMuteMine(state([track({ assetId: "bass", mine: true })]));
    const released = toggleMuteMine(engaged);
    expect(released.muteMine).toBe(false);
    expect(released.tracks[0]?.muted).toBe(false);
    expect(released.presetMuted).toEqual([]);
  });

  it("leaves a track you had ALREADY muted by hand still muted on release", () => {
    // The preset must not undo a decision that predates it.
    const engaged = toggleMuteMine(state([track({ assetId: "bass", mine: true, muted: true })]));
    expect(engaged.presetMuted).toEqual([]);
    const released = toggleMuteMine(engaged);
    expect(released.tracks[0]?.muted).toBe(true);
  });

  it("does nothing visible when none of the tracks are yours", () => {
    const next = toggleMuteMine(state([track({ assetId: "gtr" })]));
    expect(next.tracks[0]?.muted).toBe(false);
    expect(next.presetMuted).toEqual([]);
  });
});

describe("setMuted", () => {
  it("takes a hand-muted track out of the preset's memory", () => {
    // Engaged, then the member un-mutes their own bass by hand and re-mutes
    // it. Releasing the preset must leave that decision alone.
    const engaged = toggleMuteMine(state([track({ assetId: "bass", mine: true })]));
    expect(engaged.presetMuted).toEqual(["bass"]);

    const byHand = setMuted(engaged, "bass", true);
    expect(byHand.presetMuted).toEqual([]);

    const released = toggleMuteMine(byHand);
    expect(released.tracks[0]?.muted).toBe(true);
  });

  it("leaves other tracks untouched", () => {
    const next = setMuted(state([track({ assetId: "a" }), track({ assetId: "b" })]), "a", true);
    expect(next.tracks.map((t) => t.muted)).toEqual([true, false]);
  });
});

describe("setSoloed and setFader", () => {
  it("solo is a toggle per track, not a radio", () => {
    let s = state([track({ assetId: "a" }), track({ assetId: "b" })]);
    s = setSoloed(s, "a", true);
    s = setSoloed(s, "b", true);
    expect(s.tracks.map((t) => t.soloed)).toEqual([true, true]);
  });

  it("clamps a fader on the way in, so a bad value never reaches the graph", () => {
    const s = setFader(state([track({ assetId: "a" })]), "a", 99);
    expect(s.tracks[0]?.fader).toBe(MAX_FADER);
  });
});

describe("initialMixerState", () => {
  it("opens flat with the master muted, behind the stems it would double", () => {
    const s = initialMixerState([
      { assetId: "bass", kind: "stem", mine: true },
      { assetId: "master", kind: "master", mine: false },
    ]);
    expect(s.tracks.map((t) => [t.assetId, t.muted, t.fader])).toEqual([
      ["bass", false, 1],
      ["master", true, 1],
    ]);
    expect(s.muteMine).toBe(false);
  });

  it("the master is audible the moment you unmute it", () => {
    const s = initialMixerState([{ assetId: "master", kind: "master", mine: false }]);
    expect(trackGains(setMuted(s, "master", false).tracks).get("master")).toBe(1);
  });
});

describe("failureText", () => {
  const t = mixerMessages("en");
  const labels = ["Drums", "Bass"];

  it("says the mixer could not start at all", () => {
    expect(failureText(t, labels, { kind: "cant-start" })).toBe(t.cantStart);
  });

  it("names the track that would not load", () => {
    expect(failureText(t, labels, { kind: "track", index: 1 })).toBe("Bass wouldn't load.");
  });

  it("still says something for an index it has no label for", () => {
    expect(failureText(t, labels, { kind: "track", index: 9 })).toBe(t.trackFailed(""));
  });
});

// What each track's gain should be, and what "mute my instruments" does.
//
// Pure, and in its own module for the reason `player-actions.ts` states in
// its own header: every decision the mixer makes lives somewhere a node-only
// vitest can reach, and the island is left with nothing but the Web Audio
// calls that carry the decision out. There is no DOM test environment in this
// repo, so logic that stays in the `.tsx` is logic nothing can check.

/** One track's controls. Serialisable on purpose — see the note at the bottom. */
export interface TrackControl {
  assetId: string;
  /**
   * 0 to `MAX_FADER`. Above unity is deliberate: the point of the feature is
   * hearing one part against the rest, and the stems were mixed to sum to the
   * master, so "a bit more bass than the record has" needs headroom above 1.
   */
  fader: number;
  muted: boolean;
  soloed: boolean;
  /** One of the listening member's own instruments. Never true for the master. */
  mine: boolean;
}

export const MAX_FADER = 1.4;

export interface MixerState {
  tracks: readonly TrackControl[];
  /** Whether the "mute my instruments" preset is engaged. */
  muteMine: boolean;
  /**
   * Which tracks the PRESET muted, as opposed to which the member muted by
   * hand.
   *
   * Without this, releasing the preset un-mutes a track the member had
   * deliberately silenced before pressing it, which reads as the app undoing
   * their work. With it, releasing touches only what engaging touched.
   */
  presetMuted: readonly string[];
}

/**
 * The audible set, and therefore the gain, for every track.
 *
 * Solo is exclusive across the whole mixer: as soon as anything is soloed,
 * everything not soloed goes silent, which is what makes it useful for
 * "what is that noise" rather than a second mute.
 *
 * Mute still wins on its own track. A track that is both soloed and muted is
 * silent, because the member muted it and nothing they did afterwards said
 * otherwise — DAWs disagree about this and the least surprising reading is
 * that an explicit silence stays silent.
 */
export function trackGains(tracks: readonly TrackControl[]): Map<string, number> {
  const anySoloed = tracks.some((track) => track.soloed);
  const gains = new Map<string, number>();
  for (const track of tracks) {
    const audible = (anySoloed ? track.soloed : true) && !track.muted;
    gains.set(track.assetId, audible ? clampFader(track.fader) : 0);
  }
  return gains;
}

export function clampFader(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(MAX_FADER, value));
}

/**
 * Engage or release "mute my instruments" — the one preset, and the reason
 * the whole feature exists: hear the band without your own part.
 *
 * Engaging mutes every track of yours that is not already muted, and
 * remembers exactly which ones it touched. Releasing un-mutes only those.
 */
export function toggleMuteMine(state: MixerState): MixerState {
  if (state.muteMine) {
    const restore = new Set(state.presetMuted);
    return {
      tracks: state.tracks.map((track) =>
        restore.has(track.assetId) ? { ...track, muted: false } : track,
      ),
      muteMine: false,
      presetMuted: [],
    };
  }

  const touched: string[] = [];
  const tracks = state.tracks.map((track) => {
    if (!track.mine || track.muted) {
      return track;
    }
    touched.push(track.assetId);
    return { ...track, muted: true };
  });
  return { tracks, muteMine: true, presetMuted: touched };
}

/**
 * Muting or unmuting a track BY HAND while the preset is engaged takes it out
 * of the preset's memory.
 *
 * The member has expressed an opinion about that track, and the preset must
 * not overwrite it on release. Route every hand mute through here rather than
 * setting `muted` directly, or the preset will quietly reverse a decision
 * made after it was engaged.
 */
export function setMuted(state: MixerState, assetId: string, muted: boolean): MixerState {
  return {
    ...state,
    tracks: state.tracks.map((track) => (track.assetId === assetId ? { ...track, muted } : track)),
    presetMuted: state.presetMuted.filter((id) => id !== assetId),
  };
}

/**
 * Solo is a plain per-track toggle, not a radio: soloing two tracks to hear
 * the rhythm section together is the second thing anyone tries.
 */
export function setSoloed(state: MixerState, assetId: string, soloed: boolean): MixerState {
  return {
    ...state,
    tracks: state.tracks.map((track) => (track.assetId === assetId ? { ...track, soloed } : track)),
  };
}

export function setFader(state: MixerState, assetId: string, fader: number): MixerState {
  return {
    ...state,
    tracks: state.tracks.map((track) =>
      track.assetId === assetId ? { ...track, fader: clampFader(fader) } : track,
    ),
  };
}

/**
 * The mixer opens flat, with the master muted behind the stems it would
 * otherwise double.
 *
 * `TrackControl[]` is a plain serialisable array on purpose. Nothing persists
 * a mix today — that is settled — but the first request after shipping will
 * be for it, and this shape survives a `sessionStorage` round trip or a URL
 * fragment without anything else being restructured.
 */
export function initialMixerState(
  tracks: readonly { assetId: string; kind: "master" | "stem"; mine: boolean }[],
): MixerState {
  return {
    tracks: tracks.map((track) => ({
      assetId: track.assetId,
      fader: 1,
      muted: track.kind === "master",
      soloed: false,
      mine: track.mine,
    })),
    muteMine: false,
    presetMuted: [],
  };
}

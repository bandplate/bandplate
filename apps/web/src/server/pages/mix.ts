import { playableSources } from "@bandplate/core";
import type { Db } from "@bandplate/db";
import { membersRepo } from "@bandplate/db";
// `/takes/[id]/mix` — every stem of one take, running together, so a member
// can play along with the band minus their own part.
//
// The archive's other answer to that is the Solo drawer on the take page,
// which swaps the player's single source: you can hear ONLY the bass, never
// everything EXCEPT the bass. Pre-rendering an inverse mix per member per
// take was the alternative, and it multiplies render time and storage by the
// size of the band while going stale the moment a stem is re-rendered.
//
// Read-only, and deliberately thin: it composes `getTakeDetail` (the take,
// its song, its event, its assets) with the requesting member's own
// instruments, and answers the three questions the mixer cannot work out for
// itself — what the tracks are, which of them are YOURS, and which
// instruments have no track at all.
import { type Locale, formatLongDate, messages } from "@bandplate/i18n";
import { getTakeDetail } from "./takes.js";

export interface MixTrack {
  assetId: string;
  kind: "master" | "stem";
  /** The instrument's label, or the word for a take's main mix. */
  label: string;
  /** An `INSTRUMENT_GLYPHS` key, or null. */
  icon: string | null;
  /** A `TRACK_COLORS` key, or null for the neutral — what this lane is painted with. */
  color: string | null;
  instrumentId: string | null;
  /**
   * One of the requesting member's own instruments.
   *
   * The whole basis of the "mute my instruments" preset, and the reason this
   * loader takes a `memberId` at all. The master is never `mine`: it is
   * everyone.
   */
  mine: boolean;
}

export interface MixData {
  takeId: string;
  title: string;
  subtitle: string;
  /**
   * The stems, in the instrument vocabulary's order. NOT the master.
   *
   * It was here once, last and muted, so that A/B against the reference mix
   * was one press away. Cutting it removes a hazard as well as a row: playing
   * it alongside the stems sums two copies of one performance, which
   * comb-filters at any timing error at all, and the take page already plays
   * the master on its own.
   */
  tracks: MixTrack[];
  /**
   * The timeline's axis before any element reports metadata, and the fallback
   * for a VBR mp3 whose `duration` comes back `Infinity`.
   */
  durationMs: number;
  /** The preset hides entirely when false — a button that provably does nothing is worse than no button. */
  canMuteMine: boolean;
  /**
   * Instruments played on this take that have NO stem of their own.
   *
   * `takes.instruments` (what was played and captured) and the set of stems
   * are deliberately different — the ingest contract says so outright, and a
   * take can capture the whole band in the master while holding isolated
   * files for three players. Muting will not remove someone who only exists
   * in the master, so the page has to name them or the mixer looks broken.
   */
  onlyInMaster: string[];
}

/**
 * The minimum number of ready stems that makes a mixer worth opening.
 *
 * Below this the Solo drawer on the take page already is the right tool: with
 * one stem there is nothing to balance it against, and a mixer would be a
 * fader and a mute where a chip used to be.
 */
export const MIN_MIXER_STEMS = 2;

export async function getMixData(
  db: Db,
  takeId: string,
  memberId: string,
  locale: Locale,
): Promise<MixData | undefined> {
  const detail = await getTakeDetail(db, takeId, memberId);
  if (!detail) {
    return undefined;
  }

  const sources = playableSources(detail.assets);
  const stems = sources.filter((s) => s.kind === "stem");
  if (stems.length < MIN_MIXER_STEMS) {
    return undefined;
  }

  const mine = new Set((await membersRepo.listInstrumentsForMember(db, memberId)).map((i) => i.id));
  const t = messages(locale);

  const trackFor = (source: (typeof sources)[number]): MixTrack => {
    const instrument = source.instrumentId
      ? detail.instrumentsById.get(source.instrumentId)
      : undefined;
    return {
      assetId: source.assetId,
      kind: source.kind,
      label: instrument?.label ?? t.takes.masterLabel,
      icon: instrument?.icon ?? null,
      color: instrument?.color ?? null,
      instrumentId: source.instrumentId,
      mine: source.instrumentId !== null && mine.has(source.instrumentId),
    };
  };

  // Stems in the vocabulary's own order, so the mixer's lanes read the way
  // every other instrument list on the site does.
  const ordered = [...stems].sort((a, b) => {
    const sa = (a.instrumentId ? detail.instrumentsById.get(a.instrumentId)?.sortOrder : 0) ?? 0;
    const sb = (b.instrumentId ? detail.instrumentsById.get(b.instrumentId)?.sortOrder : 0) ?? 0;
    return sa - sb;
  });

  const tracks = ordered.map(trackFor);

  const withStems = new Set(stems.map((s) => s.instrumentId));
  const onlyInMaster = detail.instruments
    .filter((instrument) => !withStems.has(instrument.id))
    .map((instrument) => instrument.label);

  // The take's own duration is the performance length. Falling back to the
  // longest asset covers a take whose duration was never measured; a stem is
  // allowed to be SHORTER than the take, so the longest is the axis, never
  // the first.
  const longestAsset = detail.assets.reduce((max, a) => Math.max(max, a.durationMs ?? 0), 0);
  const durationMs = detail.take.durationMs ?? longestAsset;

  const song = detail.song;
  const event = detail.event;
  const kindLabel = event ? t.events.kindLabel(event.kind) : "";

  return {
    takeId: detail.take.id,
    title: song
      ? song.title
      : t.takes.heroTitleByDate(formatLongDate(locale, detail.take.recordedAt)),
    subtitle: event
      ? `${kindLabel} — ${formatLongDate(locale, event.heldAt)}`
      : (detail.take.label ?? ""),
    tracks,
    durationMs,
    canMuteMine: tracks.some((track) => track.mine),
    onlyInMaster,
  };
}

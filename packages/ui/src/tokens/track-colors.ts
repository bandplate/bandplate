/**
 * The colours an admin can give an instrument, so the mixer can tell one
 * track from another at a glance.
 *
 * A NEW VOCABULARY, not an extension of the badge palette — the same
 * argument `docs/design-foundation.md` makes for badges ("four separate
 * vocabularies sharing one component"). A track colour and a take's state
 * never label the same axis, so they may share a hue without lying. What a
 * track colour must do is differ from its SIBLINGS: seven lanes stacked on
 * one timeline is precisely the problem the badge palette's four hues were
 * never asked to solve.
 *
 * The WHOLE wheel, ten of them, evenly spaced. An earlier pass carved out the
 * arcs near gold, flare and yard so that a track could never look like a
 * status, and what came back was ten shades of the cool half — squashed, and
 * hardest to tell apart exactly where it mattered. A patch in a picker and a
 * badge on a row are read in different places for different reasons; the
 * collision was theoretical and the squashing was not.
 *
 * Lightness alternates as well as hue, so ~30-degree neighbours still
 * separate for a reader who cannot tell the hues apart. That second axis is
 * what the set actually rests on, and it is the thing to preserve if these
 * are ever re-picked.
 *
 * Measured, not eyeballed. Every value clears 4.5:1 against its own theme's
 * ground, so a colour can carry `--bp-color-on-accent` text as well as being
 * a fill — which is what lets the picker's selected tick sit directly on the
 * patch, and what stops the next use of these tokens from having to re-derive
 * the set.
 *
 * The VALUES live in `dubplate.css` (one per theme, as the semantic layer
 * does) and this module holds only the keys, so a brand swap replaces the
 * colours without touching the stored data. `instruments.color` holds one of
 * these keys — never a hex — for the same reason `instruments.icon` holds a
 * glyph key: the database records a choice, and the theme decides what that
 * choice looks like.
 */
export interface TrackColor {
  /** The CSS custom property the key resolves to, both themes. */
  cssVar: string;
  /** English fallback name. Admin renders the translated one and falls back to this, as it does for glyph labels. */
  label: string;
}

export const TRACK_COLORS = {
  rust: { cssVar: "--bp-track-rust", label: "Rust" },
  amber: { cssVar: "--bp-track-amber", label: "Amber" },
  lime: { cssVar: "--bp-track-lime", label: "Lime" },
  fern: { cssVar: "--bp-track-fern", label: "Fern" },
  jade: { cssVar: "--bp-track-jade", label: "Jade" },
  sea: { cssVar: "--bp-track-sea", label: "Sea" },
  sky: { cssVar: "--bp-track-sky", label: "Sky" },
  indigo: { cssVar: "--bp-track-indigo", label: "Indigo" },
  orchid: { cssVar: "--bp-track-orchid", label: "Orchid" },
  rose: { cssVar: "--bp-track-rose", label: "Rose" },
} as const satisfies Record<string, TrackColor>;

export type TrackColorKey = keyof typeof TRACK_COLORS;

/** Declaration order is the order the picker shows, which is the order of the hue wheel. */
export const TRACK_COLOR_KEYS = Object.keys(TRACK_COLORS) as TrackColorKey[];

export function isTrackColorKey(value: string): value is TrackColorKey {
  return Object.hasOwn(TRACK_COLORS, value);
}

/**
 * What to paint a track with.
 *
 * An instrument with no colour does not get a random one: it gets the
 * neutral, which is a real presentation (the same call `instruments.icon`
 * makes when it renders initials rather than inventing a glyph). Hashing the
 * slug into the palette instead would look like a choice nobody made and
 * would move every lane's colour the day an instrument is renamed.
 */
export function trackColorVar(color: string | null | undefined): string {
  return color && isTrackColorKey(color)
    ? `var(${TRACK_COLORS[color].cssVar})`
    : "var(--bp-track-none)";
}

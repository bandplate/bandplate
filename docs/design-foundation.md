# Design foundation — "Dubplate"

Settled 2026-09-08. This is the sheet every UI increment is built against.
Canvas (palettes, specimens, the explorations that led here):
<https://claude.ai/code/artifact/137e3799-bce4-45af-94ec-0934e3a93ac4>

The name is the brief. A *dubplate* is the one-off acetate a sound system cuts
for a single sound — which is exactly what this app archives. The design reads a
take as a plate: lacquer ground, gold cut into it, a hand-inked label. Reggae
arrives through material and colour rather than through a rasta stripe, which
leaves red and green free to *mean* something (rejected, published) instead of
decorating.

Token names match `packages/ui/src/tokens/*` — landing this is a value swap, not
a rename.

## Typography

Three faces, one job each, no overlap. All three are on Google Fonts.

| Token | Family | Weights | Job |
|---|---|---|---|
| `--bp-font-display` | Zilla Slab | 500 / 600 / 700 | Song and event titles, page headings, big counts. Never a sentence, never under 17px. |
| `--bp-font-body` | Chivo | 300 / 400 / 600 / 900 | Everything else — prose, labels, timecode, counts, buttons, fields. |
| `--bp-font-mono` | Spline Sans Mono | 400 / 600 | Content only, two places. See the rule. |

Alfa Slab One is Clarendon-descended — the type on a 7" label. Chivo is from the
same foundry (Omnibus-Type), so the skeletons are related rather than merely
compatible. Both cover Czech diacritics.

### The mono rule

> Mono is for text whose **horizontal position carries meaning**, and for strings
> a human transcribes character by character.

That is exactly two things:

1. **Pasted chord charts.** `songs.chordProgression` is free text. A chart pasted
   from a songbook is already aligned with spaces and the app has no idea which
   chord belongs to which syllable — render it proportionally and the alignment
   collapses. (Structured chord-to-syllable anchoring would remove this case, but
   that is an editor change, not a font change.)
2. **Machine strings in the admin UI** — service tokens (`bpk_…`), storage keys,
   sha256 — where `1`/`l` and `0`/`O` must stay distinguishable.

**Not mono:** eyebrows, meta lines, durations, BPM, keys, vote counts, timecode,
badges, buttons, table cells. A clock is not a character grid; it needs
equal-width digits, which `font-variant-numeric: tabular-nums` gives you in
Chivo. Pair it with a fixed `min-width` on any value that ticks, so the layout
holds regardless of whether the face shipped `tnum` or whether it has loaded yet.

This rule exists because mono was previously carrying four jobs (chords,
timecode, small labels, machine strings) and reading as a developer tool. Two of
those four were never its work.

### Scale

| Token | Face / size | Used for |
|---|---|---|
| `--bp-text-hero` | slab 44 / 1.0 | Page title, song detail header |
| `--bp-text-title` | slab 27 / 1.05 | Event header, section heads |
| `--bp-text-section` | slab 20 / 1.25, **600** | Section heading inside a page |
| `--bp-text-row` | slab 19 / 1.15, 600 | Song and take names in lists |
| `--bp-text-lyric` | Chivo 19 / 1.7 | Lyrics — a floor, not a suggestion |
| `--bp-text-prose` | Chivo 17 / 1.55 | Notes, descriptions, empty states |
| `--bp-text-ui` | Chivo 15 / 1.4 | Default — buttons, fields, table cells |
| `--bp-text-meta` | Chivo 12.5 / 1.5 | Durations, counts, timestamps · tabular |
| `--bp-text-note` | Chivo 11.5 / 1.45 | A human's aside about an item — a take's label, a stub's "needs details" |
| `--bp-text-eyebrow` | Chivo 900 11 / .22em caps | Caps label above a block |
| `--bp-text-chord` | mono 600 14 / 1.7 | Pasted chord charts only |
| `--bp-text-machine` | mono 12.5 / 1.6 | Tokens, keys, hashes — admin only |

Lyrics and chords are read at arm's length, while playing, in bad light. 19px is
the floor for both.

`--bp-text-note` was added the same way, for the same reason: a take's own label
had no token, so it was set at `meta` size and then **dimmed with `opacity: 0.82`**
to push it back. That is the wrong instrument twice over — it says nothing about
what the text *is*, and it invalidates the contrast the colour token was chosen
for: muted at 82% measures **3.74:1 in the light theme**, under AA. `note` is a
real step below `meta` with a different job (`meta` is the app's own formatted
data; `note` is something a person wrote), and the colour token stays at full
strength.

**Nothing in the system is italic.** Zilla Slab has no italic cut, so a slanted
title was a browser-synthesised oblique, and Chivo's true italic sits awkwardly
against the upright slabs directly above it. Subordination comes from size and
colour.

`--bp-text-section` was added after the fact, and the gap is worth recording:
the scale jumped from a page title straight to a row title, so a *section*
heading inside a page — the "Badges" above a group — had no token and was set ad
hoc in Chivo 700 at 18px. It read as a dense little block for the same reason
Alfa Slab failed at row size: a weight that is right at 44px is wrong at 18px.
The lesson generalises — **a heading step that no token covers will be invented
badly at the call site**, so the scale must cover every size a heading actually
occurs at, and `/dev/ui` must show every step, or the missing one is invisible
in review.

### Meta lines

Row metadata is **data fields, not a sentence**. The `·` separator is a default
rather than a decision, and it also mis-frames three separate values as one
string. Settled 2026-09-08:

- **In lists — columns.** Length and key become right-aligned columns of fixed
  width. The separator question disappears, and the values line up down the list
  where they actually get compared. A missing value renders as `—` so the gap
  reads as deliberate rather than broken.
- **On detail pages — labelled fields.** A caps micro-label above each value; the
  labels do the grouping. Costs about 14px of height per row, which a detail page
  has and a list does not.
- **Inline, where a line genuinely cannot be either** (breadcrumb, player
  subtitle) — a 1px CSS rule at 60% cap-height in `--bp-color-border`. Not a
  glyph: it holds its height regardless of the face, takes the theme's colour,
  and can be hidden at narrow widths without touching the text.

Never the middot.

## Palette

Dark is the authored theme; light is a real counterpart, not a stretch.

### Dark

| Token | Value | Contrast on ground |
|---|---|---|
| `--bp-color-bg` | `#150C07` lacquer | — |
| `--bp-color-surface` | `#211408` sleeve | — |
| `--bp-color-border` | `#3A2413` | — |
| `--bp-color-fg` | `#F2E8D8` bone | 14.9:1 |
| `--bp-color-muted` | `#A9917A` dust | 6.5:1 |
| `--bp-color-accent` | `#F6AA1C` gold | 9.8:1 |
| `--bp-color-danger` | `#D94A1F` flare | 4.6:1 — badges and 18px+ only |
| `--bp-color-ok` | `#6F9A2E` yard | 5.8:1 |

### Light

| Token | Value | Contrast on ground |
|---|---|---|
| `--bp-color-bg` | `#F2E8D8` bone | — |
| `--bp-color-surface` | `#FBF5E9` | — |
| `--bp-color-border` | `#DDD0BA` | — |
| `--bp-color-fg` | `#1C0F06` | 16.4:1 |
| `--bp-color-muted` | `#6D5947` | 5.4:1 |
| `--bp-color-accent` | `#7A4E05` burnt gold | 5.9:1 |
| `--bp-color-danger` | `#9C2F10` | 6.5:1 |
| `--bp-color-ok` | `#3D5C17` | 6.4:1 |

Two rules that are easy to get wrong and have been got wrong before:

- **Gold is a dark-theme accent only.** On bone it measures 2.1:1. In the light
  theme it demotes to a fill and rule colour — playhead, progress bar, keeper
  badge background — never text, never a border you need to see. The light accent
  role goes to burnt gold `#7A4E05`: same hue, lightness that clears AA.
- **`--bp-color-on-accent` follows the ground — and that used to be a bug.**
  This is the text colour painted on an accent fill. Under the previous ROOST
  palette the accents were the *same dark hex in both themes*, so text on them
  had to be a fixed light colour; letting it follow `--bp-color-bg` put espresso
  on rust in dark mode at 1.69:1, which shipped once and was fixed by pinning
  the token. **Dubplate inverts the premise.** Its accents flip lightness with
  the theme — a light gold on the dark ground, a dark burnt gold on the light
  one — so the correct foreground on any fill is always the theme's own ground,
  and `var(--bp-color-bg)` is self-maintaining rather than wrong:

  | | on accent | on danger | on ok |
  |---|---|---|---|
  | dark (lacquer text) | 9.8:1 | 4.6:1 | 5.8:1 |
  | light (bone text) | 5.9:1 | 5.9:1 | 6.2:1 |

  Swapping this file for another brand means keeping that guarantee: either
  flip the accents' lightness with the theme as Dubplate does, or pin
  `--bp-color-on-accent` and check both directions.

## Fills

The primitive skin is **"Label"**, settled 2026-09-08: outlines replaced by
translucent fills, and state carried by a drawn device rather than by a
container. Each fill is a percentage of an existing token over whatever ground
it sits on, so it flips with the theme and survives a brand swap — no new colour
was introduced.

| Token | Value | Used by |
|---|---|---|
| `--bp-fill-subtle` | fg 12% | fields, info banners, neutral badges |
| `--bp-fill-raised` | fg 15% | secondary buttons, toasts |
| `--bp-fill-ok` | ok 24% | success banners, active/session badges |
| `--bp-fill-alert` | danger 24% | error banners, invalid fields, concert badges |
| `--bp-fill-accent` | accent 24% | keeper and admin badges |
| `--bp-color-placeholder` | fg 70% over `--bp-fill-subtle` | input placeholders |

Three rules came out of the fill weights, each because something measured
wrong at the weight that looks right:

- **Muted text never sits on a fill.** On the 12% fill it measures 4.26:1 in the
  light theme. Anything on a fill takes `--bp-color-fg`, which clears 9.8:1 on
  even the lightest tint. `--bp-color-muted` is for text on the plain ground.
  Placeholders are the one exception and use `--bp-color-placeholder`, a
  different mechanism measuring 6.5:1 or better.
- **The destructive button is a solid fill, not a tint.** A danger tint heavy
  enough to see lands within **1.05:1** of the secondary button's tint in the
  dark theme — Cancel and Delete would differ by hue alone, which is no
  difference to a red-blind viewer standing in a confirm dialog. Solid puts
  3.2:1 between them, separating by weight instead.
- **…and it carries an icon.** Solid danger against solid accent measures
  **1.03:1** in the light theme; burnt gold and rust are nearly the same
  lightness. Colour cannot be the only marker of a destructive action.

Focus on a field is an **inset** ring, never an outset border: an outset border
adds 2px to the box and shifts every sibling by a pixel the moment a field takes
focus.

Checkboxes are drawn, not the platform's. `accent-color` recolours only the tick
and leaves the browser's own box — a hard white square on the lacquer ground, and
the most obviously unstyled thing on a page. The drawn control is a circle
echoing the mark, over a real `<input>` so keyboard, label association and form
submission are untouched.

Skeletons exist for the two places that genuinely wait: a `server:defer`
island's fallback slot, and an island fetching after mount. Everything else is
server-rendered and has no loading state at all. A skeleton shares the real
component's radius and spacing and matches its line count and width
distribution; the sweep is the one animation in the system that repeats, which
is why it is confined to a state that is by definition temporary.

### Badges

**Solid, not tinted.** A badge is 12px of text in a 60px pill; at that size a
24% tint has no presence and every kind reads as the same washed-out lozenge.
Solid fills carry the same weight language as the buttons — solid says "this is
a fact about the row", tint says "this is chrome". Text is
`--bp-color-on-accent`: accent 9.8/5.9, ok 5.8/6.3, danger 4.6/6.1. The neutral
default keeps `--bp-fill-raised` with fg text (8.2/9.2), having no coloured fill
to sit on.

**Four colours across six-plus names is deliberate.** These are four separate
vocabularies sharing one component, not one scale:

| Vocabulary | Values |
|---|---|
| Event kind | rehearsal · concert · session |
| Take state | new · published · keeper · rejected |
| Member role | member · admin |
| Member status | invited · active · disabled |

Siblings within a vocabulary must differ, and they do. Two badges from
*different* vocabularies may share a colour, because they never label the same
axis — `keeper` (a take) and `admin` (a person) are never a choice between each
other. A fifth hue would mean inventing a colour outside the brand palette to
solve a problem no reader has. `/dev/ui` groups them by vocabulary so the
shared colours read as what they are.

### Rows are hairlines, not cards

`.bp-event-row` was a rounded container with a 4px coloured left border. That is
a pattern to avoid on its own, and here it also double-encoded: the row already
renders a kind badge, so a concert said "concert" twice while the border was the
only signal that a rehearsal was a rehearsal. With solid badges carrying the
kind, the border and the card are gone and rows are separated by a continuous
hairline — which is what lets a list read as one index rather than as ten boxes.

## Instrument icons

Instruments show a glyph, not their name spelled out — a full list ran longer
than the song title above it and blurred into the take's own label on the same
muted line.

**The glyph is a choice stored on the row** (`instruments.icon`), not a lookup on
`slug`. The instruments table is admin-managed data, so a slug-keyed map could
never be complete: a band adds a melodica and the map has no entry. Storing the
key makes the set open — adding an instrument becomes picking a glyph rather
than shipping code. The column is nullable with no default and no backfill;
**null renders the instrument's initials**, which is a real presentation and also
exactly what every row shows before anyone picks anything.

Keys are validated against the vendored library on write. An unknown key renders
initials too, so a glyph removed in a later release degrades rather than
disappearing.

### Where the glyphs come from

**Game Icons**, vendored into `packages/ui/src/icons/instruments.ts`. It was the
only set surveyed that covers a band: Lucide, Tabler, Phosphor and Material
between them have guitar, piano, microphone, saxophone, trumpet and violin, and
**no drums, trombone, flute or clarinet at all** — none of them can complete the
list a roots band fields.

**Rendered at 20px**, and that number is set by the weakest glyph rather than the
average: the thin-bodied instruments (flute, clarinet, the brass) lose their form
below it, while drums and keys survive to 14.

An earlier attempt drew twelve glyphs by hand. It was incoherent and is not worth
repeating — icon design is a craft, and a text editor is not where it happens.

### Attribution is a condition, not a footnote

Game Icons is **CC BY 3.0**: commercial use and modification are fine, but
visible credit is required. Bandplate is self-deployable, so that obligation
passes to **every deployer**, not just this repo — which is why the credit is
rendered in the product (the admin instruments screen) rather than living only in
a source comment. Removing it from the UI while keeping the glyphs would put
every deployment in breach.

## The take row

One component, `TakeRow.astro`, rendered by six pages in three context modes —
home, search, a song's takes, `/me`, and event detail. That generality was fine;
what was not is that **no call site opted out of anything**, so the same controls
appeared everywhere regardless of whether the page was a place to use them.

**Voting is on `/takes/[id]` only.** Keeper / not-a-keeper used to sit in every
row on all six pages, including on takes already marked keeper or rejected, and
two chunky buttons out-shouted the song title they were about. A vote cast
without playing the take is not worth much, and the page where you play it is the
page where you decide. Home's "needs your vote" becomes a queue of things to go
and listen to. A route test asserts both halves: the tally is visible to another
member on take detail, and `bp-vote-toggle` does **not** appear in a list.

The freed column took the **instruments**. On the take's own line they were more
words competing with the title; in the trailing column they read as a column,
scannable down a list the way the durations beside them already are.

Three smaller corrections, each of which had a reason that turned out to be wrong:

- **The row is not a link.** A stretched overlay gave the title a 44px target,
  but it makes every part of a row a link — including the space around controls
  that do something else — and turns text selection into navigation. The target
  now comes from padding the link and pulling the same amount back off the block,
  so it grows without the row doing.
- **Play is a filled accent disc**, the mark's own shape, and the one place the
  accent belongs inside a list. A bare glyph gave a playable take no more
  presence than an unplayable one. The 44px target is the box; the visible plate
  is 34px, so a list of them does not read as a list of buttons.
- **The take's own note is dimmed to 82%** and separated from what follows it. It
  was reading at the weight of the song title above it, which inverts what the
  row is for. The vote tally sentence ("2 of 2 votes say keeper (100%)") is gone
  entirely — nobody scans a sentence on every row.

## Geometry

A plate has a sleeve, not a drop shadow.

| Token | Value |
|---|---|
| `--bp-space` | 4 · 8 · 12 · 16 · 20 · 26 · 34 · 44 · 64 |
| `--bp-radius-sm` | 3px — cards, surfaces, inputs |
| `--bp-radius-pill` | 999px — chips, badges, filters |
| `--bp-radius-disc` | 50% — play buttons, avatars |
| `--bp-hairline` | 1px solid `--bp-color-border`; **no shadows anywhere** |
| `--bp-touch-min` | 44px — every interactive target |

## Motion

One orchestrated load per page, then stillness. All of it collapses to zero under
`prefers-reduced-motion`.

| Token | Value |
|---|---|
| `--bp-stagger` | 40ms between list rows, capped at 8 rows |
| `--bp-enter` | 180ms · `translateY(8px)` → 0, opacity 0 → 1 |
| `--bp-state` | 120ms · hover, focus, pressed |
| `--bp-ease` | `cubic-bezier(.2,.7,.3,1)` — no bounce |

The gold playhead wipes in from the left on first paint. It is the only element
that animates more than once.

## Background

Atmosphere is pure CSS — no images, and it survives a brand-token swap:

```css
background:
  repeating-radial-gradient(circle at 84% 6%, rgb(246 170 28 / .05) 0 1px, transparent 1px 7px),
  radial-gradient(110% 46% at 84% 2%, rgb(246 170 28 / .12), transparent 62%),
  var(--bp-color-bg);
```

Groove rings anchored off the top-right corner at 7px pitch, under a warm gold
bloom. Barely visible by design; it should read as material, not as pattern.

## Shell — "Console"

Settled 2026-09-08 from three candidates (Console / Deck / Header).

Navigation lives where the thumb already is and the player sits directly on top
of it — one unit at the bottom of the screen. Past `lg` the tab bar is replaced
by a left rail and the player spans the full width. These are two real elements,
each `display: none` on the breakpoint it does not own, not one reflowed by
media query.

Chosen because the rehearsal room is the hard case: both the control pressed
most (play/pause) and the one pressed next (nav) are in the bottom third,
one-handed, without looking. It costs about 150px of phone height whether or not
anything is playing — roughly two take rows — which is the price of that reach.

**The gold hairline** welding the two together lives on the *player*, not the tab
bar, so it appears exactly when something is loaded. The line means "there is
audio", which is what earns it being the one piece of accent chrome permanently
on screen. With nothing loaded the tab bar keeps its ordinary border.

**Atmosphere** is a fixed pseudo-element behind the shell — groove rings at 7px
pitch under an accent bloom, both mixed from `--bp-color-accent` so a brand swap
carries them. It is masked back to the corner it is anchored to: unbounded, the
repeating radial tiles the viewport and turns into visible moiré at desktop
width. `position: fixed` on a pseudo-element rather than
`background-attachment: fixed`, which iOS Safari has never handled reliably.

**The staggered load** is CSS-only: list rows rise 8px and fade in on a 40ms
stagger, capped at eight steps so a thirty-take event does not make its last row
wait 1.2s. Applied to the existing list containers, so no page markup changed.
`animation-fill-mode: backwards` matters — without it each row paints at full
opacity for its delay and then jumps back to the animation's start.

## Primitives showcase

Storybook is not the fit — the app is Astro-first with a handful of Preact
islands. The showcase is a server-rendered `/dev/ui` route inside the app, so
primitives render in the real cascade with no parallel build, and cannot drift
from production. The islands (`VoteToggle`, `FavoriteToggle`, `PlayerBar`,
`ConfirmDialog`) mount on that same page.

## Logo

The mark is **"Cut"** — the cutting head striking in toward the centre of a
plate. Chosen 2026-09-08 from twelve candidates. A dubplate is *cut*, once, for
one sound; it is the only mark of the twelve that shows the verb the app is
named after, and it survives 16px.

### Files

| File | What it is |
|---|---|
| `apps/web/public/logo.svg` | The mark, `currentColor`, true cut-outs. Every size. |
| `apps/web/public/favicon.svg` | Identical geometry, self-coloured — flips with `prefers-color-scheme`. |
| `apps/web/public/app-icon.svg` | Opaque lockup: gold on lacquer, inset for platform rounding. Source for the PNGs. |
| `apps/web/public/apple-touch-icon.png` | 180×180 |
| `apps/web/public/icon-192.png`, `icon-512.png` | PWA / manifest |

Regenerate the PNGs from the SVG source rather than editing them:

```bash
rsvg-convert -w 180 -h 180 apps/web/public/app-icon.svg -o apps/web/public/apple-touch-icon.png
rsvg-convert -w 192 -h 192 apps/web/public/app-icon.svg -o apps/web/public/icon-192.png
rsvg-convert -w 512 -h 512 apps/web/public/app-icon.svg -o apps/web/public/icon-512.png
```

### Two rules

**Inline `logo.svg`; never `<img src="logo.svg">`.** An SVG referenced through
`<img>` (or an SVG `<image>`, or a CSS `background-image`) is rendered as an
isolated document, so `currentColor` resolves to its initial value — black — and
the mark disappears on a lacquer ground. Inlining is also what lets the mark
inherit the theme without a second file. The Astro component that lands in
milestone 2 inlines it. Where a real image element is unavoidable (OG tags,
email, a README), use `app-icon.svg`, which carries its own colours.

**One geometry at every size.** An earlier draft carried a groove ring — a 2px
stroke on a 64 grid, which is half a pixel at favicon size and renders as mud
rather than as a ring. Rather than keep an optical-size variant, the ring was
dropped from the mark itself: a filled plate, one cut, one spindle hole. The
header mark and the 16px favicon are now the same drawing, so there is nothing
to keep in sync and no crossover size to remember. `favicon.svg` differs from
`logo.svg` only in that it names its own colour.

### Colour

The mark is a single colour and takes the accent role, so it follows the same
rule as everything else: gold `#F6AA1C` on dark, burnt gold `#7A4E05` on light.
Gold on bone is 2.1:1 and turns to a smudge at 16px. `favicon.svg` handles the
switch itself because a browser tab has no page to inherit from.

### Lockups

Three, all using the same mark:

- **Horizontal** — mark left, `bandplate` in Alfa Slab One right. Header, nav
  rail, email. Mark height equals the wordmark cap height; the gap is one third
  of that.
- **Stacked** — mark above a centred wordmark. Login, setup, empty states.
- **Wordmark alone** — lowercase is the default; the slab is already loud
  enough. Tracked caps (`.16em`) only below 40px wide.

One mark, three lockups. Never a second mark.

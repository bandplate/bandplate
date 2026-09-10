#!/usr/bin/env python3
"""Draws `public/og-image.png` — the card every shared bandplate link shows.

Run it when the brand changes, not on every build; the PNG is committed, and
regenerating it needs two things a CI box has no reason to carry (the brand
fonts and `rsvg-convert`).

    python3 -m venv .venv && .venv/bin/pip install fonttools
    .venv/bin/python apps/web/scripts/og/build-og-image.py --fonts <dir>

`--fonts` wants ZillaSlab-Bold.ttf and Chivo[wght].ttf, which are OFL and live
in github.com/google/fonts. They are deliberately NOT vendored: nothing at
runtime needs them (the app loads its faces from Google Fonts), and a 700 KB
binary in the tree to regenerate one image occasionally is a bad trade.

--- Why the card looks like this ------------------------------------------

It is the auth screen. `/login` is the one surface in the whole app that says
what this thing IS — everywhere else the archive speaks for itself and a pitch
would be noise — and a share card has exactly that job. So it reuses that
screen's parts: the same dark field and glow, the same plate bleeding off its
own edge, the same wordmark, and the same single sentence of pitch. Someone
who follows the link lands on the page the card was drawn from.

--- Why the text is OUTLINED ----------------------------------------------

`rsvg-convert` resolves fonts through CoreText on macOS, not fontconfig, so a
`font-family="Zilla Slab"` fell back to a system grotesque no matter what
fontconfig was told — silently, and only visible by looking at the result.
Every string here is converted to a path instead, which also means the render
does not depend on what happens to be installed.
"""

import argparse
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from textpath import text_path  # noqa: E402

W, H = 1200, 630

# --- tokens, lifted verbatim from packages/ui/src/tokens/dubplate.css ---
FIELD = "#1b1008"  # --bp-auth-field
FIELD_GLOW = "#34210f"  # --bp-auth-field-glow
VINYL = "#17100a"  # --bp-plate-vinyl
GOLD = "#f6aa1c"  # --bp-gold
BONE = "#f2e8d8"  # --bp-bone / --bp-auth-field-fg
DUST = "#a9917a"  # --bp-auth-field-muted

# Every circle shares ONE centre, as `.bp-auth-plate` does — so the drawing
# stays concentric and the composition is moved by editing two numbers.
CX, CY = 196, 430
R_RING, R_DISC, R_LABEL, R_SPINDLE = 345, 300, 96, 15

# Where the words start. Clear of the disc's right edge (CX + R_DISC = 496),
# and far enough from the card's own edge to survive a platform's crop.
TEXT_X = 560
MARK = 52
MARK_Y = 300

PITCH = [
    "Every rehearsal your band has recorded,",
    "in one place, with the keepers marked.",
]


def grooves() -> str:
    """`repeating-radial-gradient(... 0 1px, transparent 1px 6px)`, as circles.

    That CSS rule draws hairlines every 6px; these are the same hairlines. A
    gradient would work too, but circles are what it actually amounts to and
    they survive the SVG -> PNG step without banding.
    """
    out = []
    r = R_LABEL + 8
    while r < R_DISC - 2:
        out.append(
            f'<circle cx="{CX}" cy="{CY}" r="{r}" fill="none" '
            f'stroke="{BONE}" stroke-opacity="0.07" stroke-width="1"/>'
        )
        r += 6
    return "\n  ".join(out)


def build_svg(fonts: pathlib.Path) -> str:
    zilla = fonts / "ZillaSlab-Bold.ttf"
    chivo = fonts / "Chivo[wght].ttf"
    for f in (zilla, chivo):
        if not f.exists():
            raise SystemExit(f"missing font: {f}")

    wordmark, _ = text_path(zilla, "bandplate", 72, TEXT_X + MARK + 22, MARK_Y + MARK - 8)
    pitch = "".join(
        text_path(chivo, line, 30, TEXT_X, MARK_Y + MARK + 62 + i * 42, weight=400)[0]
        for i, line in enumerate(PITCH)
    )

    # The mark, from public/logo.svg — same geometry, scaled onto the card. Its
    # light areas are true cut-outs, so it is one mask over one filled rect.
    mark = f"""<g transform="translate({TEXT_X} {MARK_Y}) scale({MARK / 64})">
    <mask id="bp-cut">
      <rect width="64" height="64" fill="#000"/>
      <circle cx="32" cy="32" r="30" fill="#fff"/>
      <path d="M57 9 L37 29" stroke="#000" stroke-width="7" stroke-linecap="round"/>
      <circle cx="32" cy="32" r="6.5" fill="#000"/>
    </mask>
    <rect width="64" height="64" fill="{GOLD}" mask="url(#bp-cut)"/>
  </g>"""

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <radialGradient id="glow" cx="{CX / W:.4f}" cy="{CY / H:.4f}" r="0.75">
      <stop offset="0" stop-color="{FIELD_GLOW}"/>
      <stop offset="0.7" stop-color="{FIELD_GLOW}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="{W}" height="{H}" fill="{FIELD}"/>
  <rect width="{W}" height="{H}" fill="url(#glow)"/>

  <circle cx="{CX}" cy="{CY}" r="{R_RING}" fill="none" stroke="{GOLD}" stroke-opacity="0.22" stroke-width="1"/>
  <circle cx="{CX}" cy="{CY}" r="{R_DISC}" fill="{VINYL}"/>
  {grooves()}
  <circle cx="{CX}" cy="{CY}" r="{R_LABEL}" fill="{GOLD}"/>
  <circle cx="{CX}" cy="{CY}" r="{R_SPINDLE}" fill="{FIELD}"/>

  {mark}
  <g fill="{BONE}">{wordmark}</g>
  <g fill="{DUST}">{pitch}</g>
</svg>
"""


def main() -> None:
    here = pathlib.Path(__file__).resolve()
    default_out = here.parents[2] / "public" / "og-image.png"

    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts", type=pathlib.Path, required=True)
    ap.add_argument("--out", type=pathlib.Path, default=default_out)
    ap.add_argument("--svg", type=pathlib.Path, help="also write the intermediate SVG")
    args = ap.parse_args()

    svg = build_svg(args.fonts)
    svg_path = args.svg or args.out.with_suffix(".svg")
    svg_path.write_text(svg)
    subprocess.run(
        ["rsvg-convert", "-w", str(W), "-h", str(H), "-o", str(args.out), str(svg_path)],
        check=True,
    )
    if args.svg is None:
        svg_path.unlink()
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()

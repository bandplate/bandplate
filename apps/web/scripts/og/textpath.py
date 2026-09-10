"""Turn a string into ONE SVG path, using the real brand font.

The card is rendered by rsvg-convert, which on macOS resolves fonts through
CoreText rather than fontconfig — so a `font-family="Zilla Slab"` in the SVG
silently fell back to a system grotesque no matter what fontconfig was told.
Outlining removes the question: the committed PNG is the deliverable, and a
path needs no font installed on whoever's machine regenerates it.
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.varLib.instancer import instantiateVariableFont


def text_path(font_path, text, size, x, y, weight=None, letter_spacing=0.0):
    font = TTFont(font_path)
    if weight is not None and "fvar" in font:
        font = instantiateVariableFont(font, {"wght": weight}, inplace=False)
    upm = font["head"].unitsPerEm
    scale = size / upm
    glyphset = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]

    parts, pen_x = [], 0.0
    for ch in text:
        name = cmap.get(ord(ch))
        if name is None:
            raise SystemExit(f"no glyph for {ch!r} in {font_path}")
        pen = SVGPathPen(glyphset)
        glyphset[name].draw(pen)
        d = pen.getCommands()
        if d:
            parts.append(f'<path d="{d}" transform="translate({pen_x:.2f} 0)"/>')
        pen_x += hmtx[name][0] + letter_spacing * upm

    width = pen_x * scale
    # The glyph coordinate system has y pointing UP; flip it and put the
    # origin on the baseline at (x, y).
    body = "".join(parts)
    return (
        f'<g transform="translate({x} {y}) scale({scale:.6f} {-scale:.6f})">{body}</g>',
        width,
    )

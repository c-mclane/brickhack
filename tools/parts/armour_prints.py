#!/usr/bin/env python3
"""Prints for body armour (decals: web/assets/brick/decals/), drawn over the
part's own colour, so one print serves every colour (a dragon's scales in red,
in blue...):

  armour_prints.py   -> decals/scales.png   overlapping scales (scale mail, dragon scale mail)
                        decals/studs.png    rows of metal studs (studded leather armor)
                        decals/rings.png    rings sewn side by side on backing (ring mail, on the torso)
                        decals/chain.png    a 4-in-1 weave of linked rings (chain mail, mithril, on the torso)

Only shading is drawn (dark and light, part-transparent); the part's colour
shows through.
"""
import math, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'assets', 'brick', 'decals')
S = 256   # image size
SHADE, LIGHT = (0, 0, 0, 120), (255, 255, 255, 90)


def scales(rows=7, cols=6):
    """Rows of round-bottomed scales, each row overlapping the one above (half a scale across)."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = S / cols; h = S / rows
    for r in range(rows + 1):
        y = r * h
        for c in range(-1, cols + 1):
            x = c * w + (w / 2 if r % 2 else 0)
            box = [x, y - h * 0.9, x + w, y + h * 0.9]
            d.chord(box, 0, 180, fill=(0, 0, 0, 0), outline=SHADE, width=3)   # the scale's rim, round at the bottom
            d.arc([box[0] + 5, box[1] + 5, box[2] - 5, box[3] - 5], 30, 150, fill=LIGHT, width=2)   # a gleam inside it
    return im


def studs(rows=6, cols=5):
    """Metal studs in rows, each with a shadow and a highlight."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = S / cols; h = S / rows; r = min(w, h) * 0.2
    for i in range(rows):
        for j in range(cols):
            x = (j + 0.5 + (0.5 if i % 2 else 0) - (0.5 if i % 2 and j == cols - 1 else 0)) * w
            y = (i + 0.5) * h
            d.ellipse([x - r + 2, y - r + 3, x + r + 2, y + r + 3], fill=(0, 0, 0, 110))       # its shadow
            d.ellipse([x - r, y - r, x + r, y + r], fill=(176, 181, 184, 255))                 # the stud, silver
            d.ellipse([x - r * 0.5, y - r * 0.6, x, y - r * 0.1], fill=(255, 255, 255, 200))   # its shine
    return im


def ring(d, x, y, rx, ry, tilt, width=3):
    """A ring seen at a slant: an ellipse turned by tilt degrees, dark with a gleam on its upper edge."""
    t = math.radians(tilt)
    def pt(a, sx=1.0):
        px, py = rx * sx * math.cos(a), ry * sx * math.sin(a)
        return (x + px * math.cos(t) - py * math.sin(t), y + px * math.sin(t) + py * math.cos(t))
    n = 28
    d.line([pt(2 * math.pi * k / n) for k in range(n + 1)], fill=(25, 25, 25, 190), width=width)
    d.line([pt(math.pi + math.pi * 0.15 + math.pi * 0.7 * k / 10, 0.8) for k in range(11)], fill=(240, 240, 240, 190), width=max(1, width - 1))


def rings(rows=7, cols=5):
    """Ring mail: rings sewn flat side by side on leather, each on its own (not linked)."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = S / cols; h = S / rows
    for i in range(rows):
        for j in range(cols):
            x = (j + 0.5 + (0.5 if i % 2 else 0)) * w
            y = (i + 0.5) * h
            ring(d, x, y, w * 0.34, h * 0.36, 0, 6)
    return im


def chain(rows=12, cols=7):
    """Chain mail: the 4-in-1 weave. Rows of rings, each row set half a ring
    across from the last and leaning the other way, every ring overlapping two
    above and two below (the four it runs through)."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = S / cols; h = S / rows
    for i in range(-1, rows + 1):
        for j in range(-1, cols + 1):
            x = (j + 0.5 + (0.5 if i % 2 else 0)) * w
            y = (i + 0.5) * h
            ring(d, x, y, w * 0.56, h * 0.95, 25 if i % 2 else -25, 4)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, im in (('scales', scales()), ('studs', studs()), ('rings', rings()), ('chain', chain())):
        path = os.path.join(OUT, name + '.png')
        im.save(path)
        print(path)


if __name__ == '__main__':
    main()

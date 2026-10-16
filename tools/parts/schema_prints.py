#!/usr/bin/env python3
"""Prints for the Orthodox Great Schema monk (decals/), on his black habit,
all embroidered in white, as the Great Schema is:

  schema_prints.py   -> decals/analavos-top.png    the analavos on his chest
                        decals/analavos-skirt.png  ...and down his robe
                        decals/koukoulion.png      the cross at the peak of his hood
                        decals/schema-cape.png     the Golgotha cross on the back of his cape

The analavos is a long narrow band hanging down the front of the habit: a
white rule down each edge with the Trisagion lettered between (СВЯТЫЙ
БОЖЕ, СВЯТЫЙ КРЕПКІЙ, СВЯТЫЙ БЕЗСМЕРТНЫЙ, ПОМИЛУЙ НАСЪ), and down its middle,
top to foot: three crosses; the three-barred cross on the steps of Golgotha,
ІС ХС НИ КА (Jesus Christ conquers) about it, Adam's skull in the cave beneath; a seraph; two crosses; Golgotha again; three
crosses. The chest carries it to the seraph, the robe the rest.
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'assets', 'brick', 'decals')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
WHITE = (236, 234, 226, 255)
PX = 12            # pixels per LDU
BAND = 10 * PX     # the motifs' width (drawn at this size: crosses, Golgotha, the seraph)
WIDE = 14 * PX     # the band's width on the torso and the robe: the motifs enlarged to fill it
GROW = WIDE / BAND
TRISAGION = 'СВЯТЫЙБОЖЕСВЯТЫЙКРЕПКІЙСВЯТЫЙБЕЗСМЕРТНЫЙПОМИЛУЙНАСЪ'


def bar(d, x0, y0, x1, y1, w):
    a = math.atan2(y1 - y0, x1 - x0)
    nx, ny = -math.sin(a) * w / 2, math.cos(a) * w / 2
    d.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill=WHITE)


def small_cross(d, x, y, r=7):
    bar(d, x - r, y, x + r, y, 4)
    bar(d, x, y - r, x, y + r, 4)


def crosses(d, y, n):
    cx = BAND / 2
    for k in range(n):
        small_cross(d, cx + (k - (n - 1) / 2) * 22, y)


def golgotha(d, y):
    """The three-barred cross on the steps of Golgotha, the skull in the cave: y its top."""
    cx = BAND / 2
    bar(d, cx, y, cx, y + 62, 5)                    # the upright
    bar(d, cx - 8, y + 9, cx + 8, y + 9, 4)         # the title
    bar(d, cx - 20, y + 21, cx + 20, y + 21, 5)     # the crossbar
    bar(d, cx - 11, y + 49, cx + 11, y + 43, 4)     # the footrest, slanting
    for k, hw in enumerate((10, 18, 26)):          # the steps
        d.rectangle([cx - hw, y + 62 + 5 * k, cx + hw, y + 66 + 5 * k], outline=WHITE, width=2)
    f = ImageFont.truetype(FONT, 11)                # ІС ХС (Jesus Christ) over the crossbar, НИ КА (conquers) under it
    for word, x, yy in (('ІС', cx - 32, y + 12), ('ХС', cx + 32, y + 12), ('НИ', cx - 32, y + 30), ('КА', cx + 32, y + 30)):
        b = d.textbbox((0, 0), word, font=f)
        d.text((x - (b[2] - b[0]) / 2 - b[0], yy - (b[3] - b[1]) / 2 - b[1]), word, font=f, fill=WHITE)
    d.ellipse([cx - 4, y + 80, cx + 4, y + 88], fill=WHITE)   # Adam's skull, beneath
    bar(d, cx - 8, y + 91, cx + 8, y + 86, 2)
    bar(d, cx - 8, y + 86, cx + 8, y + 91, 2)


def seraph(d, y):
    """A six-winged seraph: a face and three pairs of wings."""
    cx = BAND / 2
    d.ellipse([cx - 5, y - 5, cx + 5, y + 5], fill=WHITE)
    for k, (dy, l) in enumerate(((-8, 18), (0, 22), (8, 18))):
        for s in (-1, 1):
            bar(d, cx + s * 6, y + dy / 2, cx + s * l, y + dy - 6 * (1 - k), 3)


def letters(d, h):
    """The Trisagion down both edges, a letter at a time, between the rules."""
    f = ImageFont.truetype(FONT, 9)
    for x in (9, BAND - 9):
        for i, y in enumerate(range(8, h - 8, 11)):
            ch = TRISAGION[i % len(TRISAGION)]
            b = d.textbbox((0, 0), ch, font=f)
            d.text((x - (b[2] - b[0]) / 2 - b[0], y), ch, font=f, fill=WHITE)
    for x in (2, 16, BAND - 17, BAND - 3):   # the rules either side of the lettering
        d.line([(x, 0), (x, h)], fill=WHITE, width=2)


def band(h, parts):
    """The band, h pixels long: its lettered edges at full width, the motifs
    (laid out at BAND wide, h / GROW long) enlarged to fill it."""
    im = Image.new('RGBA', (WIDE, h), (0, 0, 0, 0))
    edge = Image.new('RGBA', (BAND, h), (0, 0, 0, 0))
    letters(ImageDraw.Draw(edge), h)
    im.alpha_composite(edge.crop((0, 0, 20, h)), (0, 0))                     # the left border
    im.alpha_composite(edge.crop((BAND - 20, 0, BAND, h)), (WIDE - 20, 0))   # the right
    mid = Image.new('RGBA', (BAND, int(h / GROW)), (0, 0, 0, 0))
    d = ImageDraw.Draw(mid)
    for what, y in parts:
        what(d, y / GROW)
    mid = mid.crop((18, 0, BAND - 18, mid.height)).resize((int((BAND - 36) * GROW), h), Image.LANCZOS)
    im.alpha_composite(mid, ((WIDE - mid.width) // 2, 0))
    return im


def koukoulion(S=96):
    """The three-barred cross at the peak of the hood."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    bar(d, c, 10, c, S - 10, 8)
    bar(d, c - 12, 24, c + 12, 24, 6)
    bar(d, c - 26, 40, c + 26, 40, 8)
    bar(d, c - 14, S - 26, c + 14, S - 36, 6)
    return im


def cape(S=280):
    """The back of the cape: the band's Golgotha cross under three crosses, drawn
    large, within a white rule."""
    motif = Image.new('RGBA', (BAND, 150), (0, 0, 0, 0))
    d = ImageDraw.Draw(motif)
    crosses(d, 12, 3)
    golgotha(d, 34)
    motif = motif.resize((BAND * 2, 300), Image.LANCZOS)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(im).rectangle([4, 4, S - 5, S - 5], outline=WHITE, width=4)
    im.alpha_composite(motif.crop((0, 0, BAND * 2, min(300, S - 20))), ((S - BAND * 2) // 2, 14))
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    top = band(32 * PX, [(lambda d, y: crosses(d, y, 3), 44), (golgotha, 92), (seraph, 290)])
    skirt = band(46 * PX, [(lambda d, y: crosses(d, y, 2), 60), (golgotha, 150), (lambda d, y: crosses(d, y, 3), 420)])
    for name, im in (('analavos-top', top), ('analavos-skirt', skirt), ('koukoulion', koukoulion()), ('schema-cape', cape())):
        path = os.path.join(OUT, name + '.png')
        im.save(path)
        print(path)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Prints for scrolls (decals/): a scroll is the same parchment whatever it
is, until read; only its label tells one from another (as in the game), so
each carries its label, printed:

  scroll_prints.py -> decals/scroll-tile-<label>.png   a scroll on two spindles, its label across it (a 2 x 2 tile),
                                                        for every label the game has (tiles.json)
                      decals/scroll-tile-blank.png      ...and with nothing written on it (unlabeled: blank paper)
"""
import os, re, sys
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'assets', 'brick', 'decals')
FONT = '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf'
INK, WOOD, PAPER = (60, 35, 20, 255), (110, 60, 30, 255), (236, 222, 180, 255)


def slug(label):
    return re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-')


def fit(d, text, w, h):
    """The largest font size at which text fits w x h."""
    for size in range(int(h), 4, -1):
        f = ImageFont.truetype(FONT, size)
        x0, y0, x1, y1 = d.textbbox((0, 0), text, font=f)
        if x1 - x0 <= w and y1 - y0 <= h:
            return f, (x0, y0, x1, y1)
    return ImageFont.truetype(FONT, 5), d.textbbox((0, 0), text, font=ImageFont.truetype(FONT, 5))


def splits(label):
    """The ways to set a label: on one line, or broken at its spaces into two or three."""
    w = label.split()
    out = [[label]]
    out += [[' '.join(w[:i]), ' '.join(w[i:])] for i in range(1, len(w))]
    out += [[' '.join(w[:i]), ' '.join(w[i:j]), ' '.join(w[j:])] for i in range(1, len(w)) for j in range(i + 1, len(w))]
    return out


def setting(d, lines, box):
    """The one size all of a setting's lines fit at (the longest's)."""
    x0, y0, x1, y1 = box
    lh = (y1 - y0) / len(lines)
    return min((fit(d, line, (x1 - x0) * 0.92, lh * 0.8)[0] for line in lines), key=lambda f: f.size)


def ink(d, label, box):
    """The label, set however it prints largest, one size for every line."""
    x0, y0, x1, y1 = box
    lines = max(splits(label), key=lambda ls: setting(d, ls, box).size)
    lh = (y1 - y0) / len(lines)
    f = setting(d, lines, box)
    for i, line in enumerate(lines):
        a, b, c, e = d.textbbox((0, 0), line, font=f)
        d.text(((x0 + x1) / 2 - (a + c) / 2, y0 + lh * i + lh / 2 - (b + e) / 2), line, font=f, fill=INK)


def tile(label, S=400):
    """A scroll unrolled between two spindles, its label inked across it (top view)."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([S * 0.14, S * 0.22, S * 0.86, S * 0.78], fill=PAPER, outline=(170, 140, 90, 255), width=4)
    for x in (S * 0.11, S * 0.89):   # the rollers, their knobs past the paper
        d.rounded_rectangle([x - S * 0.05, S * 0.12, x + S * 0.05, S * 0.88], radius=S * 0.04, fill=WOOD)
        for y in (S * 0.1, S * 0.9):
            d.ellipse([x - S * 0.06, y - S * 0.04, x + S * 0.06, y + S * 0.04], fill=(80, 45, 22, 255))
    if label:
        ink(d, label, (S * 0.18, S * 0.26, S * 0.82, S * 0.74))
    return im


if __name__ == '__main__':
    import json
    names = json.load(open(os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'assets', 'slashem', 'tiles.json')))
    labels = sys.argv[1:] or [n.split(' / ')[0] for n, c in zip(names['names'], names['classes'])
                              if c == 'scroll' and n.split(' / ')[0].isupper()]   # (the labels: in capitals)
    os.makedirs(OUT, exist_ok=True)
    for lab in labels:
        tile(lab).save(os.path.join(OUT, f'scroll-tile-{slug(lab)}.png'))
    tile('').save(os.path.join(OUT, 'scroll-tile-blank.png'))
    print('scroll prints:', len(labels), 'labels')

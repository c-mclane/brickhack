#!/usr/bin/env python3
"""The print on top of a stack of pancakes (decals/pancake.png), seen from
above on a round 2 x 2 tile: a pool of maple syrup spreading from the middle
with runs reaching for the edge, glossy, and a pat of butter melting on top.

  pancake_print.py   -> web/assets/lego/decals/pancake.png
"""
import math, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'assets', 'lego', 'decals', 'pancake.png')
S = 256
SYRUP, SYRUP_DARK, GLOSS = (176, 92, 18, 235), (124, 58, 10, 235), (255, 214, 150, 200)
BUTTER, BUTTER_SIDE, BUTTER_LIGHT = (252, 232, 150, 255), (222, 196, 104, 255), (255, 248, 210, 255)


def blob(c, r, wobble, n=48, phase=0.0, runs=()):
    """A wobbly round outline about c, with runs (angle, length) poking out of it."""
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        rr = r * (1 + wobble * math.sin(3 * a + phase) + 0.5 * wobble * math.sin(7 * a + 2 * phase))
        for ra, rl in runs:   # a run of syrup: the edge pulled out, narrowly
            d = math.atan2(math.sin(a - ra), math.cos(a - ra))
            rr += rl * math.exp(-(d / 0.16) ** 2)
        pts.append((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a)))
    return pts


def main():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = (S / 2, S / 2)
    runs = [(0.4, 40), (1.9, 30), (3.0, 46), (4.4, 34), (5.5, 26)]
    d.polygon(blob((c[0] + 3, c[1] + 4), 74, 0.06, runs=runs), fill=SYRUP_DARK)   # its darker, deeper edge
    d.polygon(blob(c, 70, 0.06, runs=[(a, l * 0.9) for a, l in runs]), fill=SYRUP)
    d.arc([c[0] - 52, c[1] - 52, c[0] + 52, c[1] + 52], 200, 250, fill=GLOSS, width=6)   # a shine on the syrup
    # the pat of butter, a little turned, softening at its corners
    h, t = 24, math.radians(18)
    sq = lambda s, dx=0, dy=0: [(c[0] + dx + s * (x * math.cos(t) - y * math.sin(t)), c[1] + dy + s * (x * math.sin(t) + y * math.cos(t)))
                                for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    d.polygon(sq(h, 4, 5), fill=BUTTER_SIDE)    # its sides, seen past it
    d.polygon(sq(h), fill=BUTTER)
    d.line(sq(h)[:2], fill=BUTTER_LIGHT, width=4)   # its lit edge
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    im.save(OUT)
    print(OUT)


if __name__ == '__main__':
    main()

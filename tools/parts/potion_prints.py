#!/usr/bin/env python3
"""Prints for potions whose look is a texture, not a colour (decals/), on
the front of a bottle or flask, drawn over the glass's own colour:

  potion_prints.py   -> decals/fizz.png      fine bubbles rising (fizzy, effervescent)
                        decals/bubbles.png   big round bubbles (bubbly)
                        decals/swirl.png     coloured swirls turning in it (swirly)
                        decals/sparkle.png   four-pointed glints (sparkling)
"""
import math, os, random
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'assets', 'brick', 'decals')
S = 256
RIM, SHINE = (255, 255, 255, 210), (255, 255, 255, 255)


def bubbles(n, rmin, rmax, seed):
    """Bubbles, each a bright rim with a glint, smaller toward the top as they rise."""
    rnd = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for _ in range(n):
        y = rnd.uniform(12, S - 12)
        r = rmin + (rmax - rmin) * (y / S) * rnd.uniform(0.6, 1.0)
        x = rnd.uniform(r + 4, S - r - 4)
        d.ellipse([x - r, y - r, x + r, y + r], outline=RIM, width=max(2, int(r / 4)))
        g = max(1.5, r / 3)
        d.ellipse([x - r / 2 - g / 2, y - r / 2 - g / 2, x - r / 2 + g / 2, y - r / 2 + g / 2], fill=SHINE)
    return im


def swirl():
    """Three coloured spirals winding out from the middle."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    for k, col in enumerate(((255, 80, 200, 230), (90, 200, 255, 230), (255, 230, 90, 230))):
        pts = []
        for i in range(140):
            t = i / 139
            a = 2 * math.pi * k / 3 + t * 3.2 * math.pi
            r = 6 + t * (S / 2 - 14)
            pts.append((c + r * math.cos(a), c + r * math.sin(a)))
        d.line(pts, fill=col, width=12, joint='curve')
    return im


def sparkle(seed=7):
    """Four-pointed glints, big and small."""
    rnd = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for _ in range(14):
        x, y, r = rnd.uniform(20, S - 20), rnd.uniform(20, S - 20), rnd.uniform(8, 26)
        w = r / 5
        d.polygon([(x, y - r), (x + w, y - w), (x + r, y), (x + w, y + w), (x, y + r), (x - w, y + w), (x - r, y), (x - w, y - w)], fill=SHINE)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, im in (('fizz', bubbles(60, 3, 9, 1)), ('bubbles', bubbles(14, 12, 30, 2)), ('swirl', swirl()), ('sparkle', sparkle())):
        path = os.path.join(OUT, name + '.png')
        im.save(path)
        print(path)


if __name__ == '__main__':
    main()

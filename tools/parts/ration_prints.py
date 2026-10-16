#!/usr/bin/env python3
"""The prints on army rations, in military stencil, black, cut by the
stencil's bridges as sprayed on an army box or can, seen from above:

  ration_prints.py   -> web/assets/lego/decals/k-ration.png   a K on a 1 x 2 tile (the K-ration's box)
                        web/assets/lego/decals/c-ration.png   a C on a round 1 x 1 tile (the C-ration's can lid)
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'assets', 'lego', 'decals')
W, H = 512, 256   # (the tile is twice as long as it is wide)
INK = (24, 24, 20, 235)


def k_ration():
    """A K, its stem cut across by a bridge, its arms standing clear of it."""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    top, bot = 40, H - 40
    x0, stem, gap = W / 2 - 62, 34, 10   # the stem's left, its width, the stencil's gap
    mid = (top + bot) / 2
    # the stem, cut across the middle by a bridge
    d.rectangle([x0, top, x0 + stem, mid - gap / 2], fill=INK)
    d.rectangle([x0, mid + gap / 2, x0 + stem, bot], fill=INK)
    # the arms, standing clear of the stem by the stencil's gap
    a = x0 + stem + gap   # where they start
    arm = 40              # their thickness
    d.polygon([(a, mid - arm / 2), (a + 76, top), (a + 76 + arm, top), (a + arm * 0.9, mid)], fill=INK)   # up
    d.polygon([(a + arm * 0.9, mid + gap), (a + 76 + arm, bot), (a + 76, bot), (a, mid + gap + arm / 2)], fill=INK)   # down
    return im


def c_ration(S=256):
    """A C: a thick ring open on the right, cut at its top and bottom by bridges."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c, r, w = S / 2, 78, 34
    box = [c - r, c - r, c + r, c + r]
    for a0, a1 in ((40, 84), (96, 264), (276, 320)):   # (degrees, clockwise from the right: the bridges at 90 and 270)
        d.arc(box, a0, a1, fill=INK, width=w)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, im in (('k-ration', k_ration()), ('c-ration', c_ration())):
        path = os.path.join(OUT, name + '.png')
        im.save(path)
        print(path)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""The print on the holy wafer (a Eucharistic host: decals/host.png), seen
from above on a round 1 x 1 tile: unleavened bread, cream white, with a
raised rim round its edge and a small Greek cross pressed into its middle
(drawn as an indentation: shadowed on its upper left edges, lit on its lower
right, as light from the upper left falls into it).

  host_print.py   -> web/assets/lego/decals/host.png
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'assets', 'lego', 'decals', 'host.png')
S = 256
BREAD = (250, 244, 226, 255)
SHADE, LIGHT = (120, 106, 80, 255), (255, 255, 252, 255)


def cross(d, c, arm, w, dx=0, dy=0, fill=BREAD):
    """A Greek cross (four equal arms) centred on c: arm its half-length, w its arms' width."""
    x, y = c[0] + dx, c[1] + dy
    d.rectangle([x - arm, y - w / 2, x + arm, y + w / 2], fill=fill)
    d.rectangle([x - w / 2, y - arm, x + w / 2, y + arm], fill=fill)


def main():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = (S / 2, S / 2)
    r = S / 2 - 4
    d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=BREAD)
    # the raised rim: lit on its upper left, shadowed on its lower right
    d.arc([c[0] - r + 6, c[1] - r + 6, c[0] + r - 6, c[1] + r - 6], 135, 315, fill=LIGHT, width=12)
    d.arc([c[0] - r + 6, c[1] - r + 6, c[0] + r - 6, c[1] + r - 6], -45, 135, fill=SHADE, width=10)
    # the cross pressed in: its floor a shade darker, its upper left walls in shadow, its lower right lit
    arm, w, e = 52, 30, 10
    cross(d, c, arm, w, -e, -e, SHADE)
    cross(d, c, arm, w, e, e, LIGHT)
    cross(d, c, arm, w, fill=(222, 210, 178, 255))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    im.save(OUT)
    print(OUT)


if __name__ == '__main__':
    main()

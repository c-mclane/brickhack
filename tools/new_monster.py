#!/usr/bin/env python3
"""Create a MineHack custom monster from a sprite.

  python3 tools/new_monster.py "Name" monkey path/to/sprite.png

  - mods/monsters/<name>.json   the definition: copies every stat, attack and
                                behaviour of the base SLASH'EM monster, plus a
                                16x16 game tile made from the sprite
  - art/monsters/<name>.png     the full-size sprite shown in 3D (local only)

Then rebuild with `npm run build` (or tools/build-slashem.sh + npm run tiles).
Stdlib only: reads 8-bit RGB/RGBA/grey and 1/2/4/8-bit palette PNGs.
"""
import json
import os
import shutil
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# SLASH'EM tile palette (win/share/monsters.txt); M is the transparent background
PALETTE = {
    "A": (0, 0, 0), "B": (0, 182, 255), "C": (255, 108, 0), "D": (255, 0, 0),
    "E": (0, 0, 255), "F": (0, 145, 0), "G": (108, 255, 0), "H": (255, 255, 0),
    "I": (255, 0, 255), "J": (145, 71, 0), "K": (182, 71, 0), "L": (255, 182, 145),
    "N": (255, 255, 255), "O": (218, 218, 182), "P": (108, 145, 182),
}


def read_png(path):
    """-> (width, height, rows of (r, g, b, a))"""
    d = open(path, "rb").read()
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        sys.exit("not a PNG: " + path)
    i, idat, plte, trns = 8, b"", None, None
    while i < len(d):
        n = struct.unpack(">I", d[i:i + 4])[0]
        t, c = d[i + 4:i + 8], d[i + 8:i + 8 + n]
        i += 12 + n
        if t == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", c)
        elif t == b"PLTE":
            plte = [tuple(c[k:k + 3]) for k in range(0, len(c), 3)]
        elif t == b"tRNS":
            trns = c
        elif t == b"IDAT":
            idat += c
    if interlace:
        sys.exit("interlaced PNGs aren't supported; re-save the sprite without interlacing")
    chans = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp = max(1, chans * depth // 8)
    stride = (w * chans * depth + 7) // 8
    raw = zlib.decompress(idat)
    prev = bytearray(stride)
    out, p = [], 0
    for _ in range(h):
        f, line = raw[p], bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            cc = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - cc), abs(a - cc), abs(a + b - 2 * cc)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else cc)) & 255
        prev = line
        row = []
        for x in range(w):
            if depth < 8:  # packed palette / grey
                v = (line[x * depth // 8] >> (8 - depth - (x * depth) % 8)) & ((1 << depth) - 1)
            else:
                v = None
            if ctype == 3:
                idx = v if v is not None else line[x]
                r, g, b = plte[idx]
                a = trns[idx] if trns and idx < len(trns) else 255
            elif ctype == 0:
                g = v * 255 // ((1 << depth) - 1) if v is not None else line[x]
                r = b = g; a = 255
            elif ctype == 4:
                r = g = b = line[x * 2]; a = line[x * 2 + 1]
            else:
                r, g, b = line[x * chans:x * chans + 3]
                a = line[x * chans + 3] if chans == 4 else 255
            row.append((r, g, b, a))
        out.append(row)
    return w, h, out


def make_tile(w, h, px):
    """Fit the sprite's opaque area into 16x16 (feet at the bottom), snap to the palette."""
    xs = [x for y in range(h) for x in range(w) if px[y][x][3] >= 128]
    ys = [y for y in range(h) for x in range(w) if px[y][x][3] >= 128]
    if not xs:
        sys.exit("the sprite is fully transparent")
    x0, x1, y0, y1 = min(xs), max(xs) + 1, min(ys), max(ys) + 1
    k = max(x1 - x0, y1 - y0) / 16
    tw, th = round((x1 - x0) / k), round((y1 - y0) / k)
    ox, oy = (16 - tw) // 2, 16 - th
    tile = [["M"] * 16 for _ in range(16)]
    for ty in range(th):
        for tx in range(tw):
            # average the source block this tile pixel covers
            sx0, sx1 = x0 + int(tx * k), max(x0 + int(tx * k) + 1, x0 + int((tx + 1) * k))
            sy0, sy1 = y0 + int(ty * k), max(y0 + int(ty * k) + 1, y0 + int((ty + 1) * k))
            cells = [px[y][x] for y in range(sy0, min(sy1, h)) for x in range(sx0, min(sx1, w))]
            solid = [c for c in cells if c[3] >= 128]
            if len(solid) * 2 < len(cells):
                continue
            r, g, b = (sum(c[i] for c in solid) / len(solid) for i in range(3))
            tile[oy + ty][ox + tx] = min(PALETTE, key=lambda ch: sum((v - q) ** 2 for v, q in zip((r, g, b), PALETTE[ch])))
    return ["".join(row) for row in tile]


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    name, base, sprite = sys.argv[1:4]
    slug = name.lower().replace(" ", "-")
    w, h, px = read_png(sprite)
    tile = make_tile(w, h, px)
    os.makedirs(f"{ROOT}/mods/monsters", exist_ok=True)
    json.dump({"name": name, "base": base, "tile": tile},
              open(f"{ROOT}/mods/monsters/{slug}.json", "w"), indent=2)
    os.makedirs(f"{ROOT}/art/monsters", exist_ok=True)
    shutil.copyfile(sprite, f"{ROOT}/art/monsters/{name.lower()}.png")
    print(f"mods/monsters/{slug}.json  (copies '{base}')")
    print(f"art/monsters/{name.lower()}.png  (3D sprite)")
    print("\n".join("  " + r for r in tile))
    print("Now rebuild: npm run build")


main()

#!/usr/bin/env python3
"""Prints for spellbooks whose look is a pattern, not a colour (decals/), on
the front cover of a minifig book (portrait, as the cover stands):

  book_prints.py   -> decals/book-plaid.png        red, green and navy checks (plaid)
                      decals/book-tartan.png       green and blue sett, yellow overcheck (tartan)
                      decals/book-rainbow.png      bands of the rainbow (rainbow)
                      decals/book-psychedelic.png  swirling hot colours (psychedelic)
                      decals/book-colorful.png     a patchwork of bright patches (colorful)
                      decals/book-mottled.png      dark blotches over the cover's colour (mottled)
                      decals/book-spiral.png       a wire coil down the spine (spiral-bound)
                      decals/book-stapled.png      two staples in the spine (stapled)
  ...and simple patterns for every other book, in gold, dark ink or silver to
  stand out on its cover (book-pat-<pattern>-<ink>.png): a frame, corner
  brackets, bands, a title plate, a star, a moon, a rune, rings, a lattice, a
  diamond; and for the open books, pages of text (book-pages.png)
"""
import math, os, random
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'assets', 'brick', 'decals')
W, H = 192, 272   # (the cover: 38 x 54 LDraw units)


def checks(bands, over=None):
    """A woven check: the same bands across and down, overlapping as a weave
    does (where two bands cross, their colours mix); `over`: a thin overcheck."""
    im = Image.new('RGBA', (W, H))
    px = im.load()
    def band(t):
        t %= sum(w for _, w in bands)
        for c, w in bands:
            if t < w:
                return c
            t -= w
    for y in range(H):
        for x in range(W):
            a, b = band(x), band(y)
            px[x, y] = tuple((a[i] + b[i]) // 2 for i in range(3)) + (255,)
    if over:
        d = ImageDraw.Draw(im)
        c, step, off = over
        for t in range(off, max(W, H), step):
            d.line([(t, 0), (t, H)], fill=c, width=2)
            d.line([(0, t), (W, t)], fill=c, width=2)
    return im


def rainbow():
    cols = [(220, 30, 40), (245, 130, 20), (250, 215, 30), (60, 170, 60), (40, 110, 210), (90, 50, 160), (150, 70, 190)]
    im = Image.new('RGBA', (W, H))
    d = ImageDraw.Draw(im)
    for i, c in enumerate(cols):
        d.rectangle([0, i * H / len(cols), W, (i + 1) * H / len(cols)], fill=c + (255,))
    return im


def psychedelic():
    im = Image.new('RGBA', (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            u, v = (x - W / 2) / W, (y - H / 2) / W
            r, a = math.hypot(u, v), math.atan2(v, u)
            t = a * 3 + r * 22
            px[x, y] = (int(128 + 127 * math.sin(t)), int(128 + 127 * math.sin(t + 2.1)), int(128 + 127 * math.sin(t + 4.2)), 255)
    return im


def colorful():
    rnd = random.Random(7)
    cols = [(230, 40, 60), (250, 200, 30), (40, 160, 220), (90, 190, 70), (240, 120, 30), (170, 80, 200), (250, 250, 250)]
    im = Image.new('RGBA', (W, H))
    d = ImageDraw.Draw(im)
    for y in range(0, H, 34):
        for x in range(0, W, 32):
            d.rectangle([x, y, x + 32, y + 34], fill=rnd.choice(cols) + (255,))
    return im


def blotches(n, rmin, rmax, colour, seed, rings=False):
    rnd = random.Random(seed)
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for _ in range(n):
        x, y, r = rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(rmin, rmax)
        if rings:   # a cup's ring
            d.ellipse([x - r, y - r, x + r, y + r], outline=colour, width=5)
        else:   # a blotch: a few overlapping blobs
            for _ in range(4):
                dx, dy, rr = rnd.uniform(-r / 2, r / 2), rnd.uniform(-r / 2, r / 2), r * rnd.uniform(0.5, 0.9)
                d.ellipse([x + dx - rr, y + dy - rr, x + dx + rr, y + dy + rr], fill=colour)
    return im


def spiral():
    """A wire coil down the spine (the cover's left edge, as it faces you)."""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for y in range(10, H - 6, 16):
        d.ellipse([-10, y, 22, y + 11], outline=(200, 205, 215, 255), width=4)
    return im


def stapled():
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for y in (H * 0.25, H * 0.75):
        d.rectangle([4, y - 18, 11, y + 18], fill=(205, 210, 220, 255))
    return im


def star(d, x, y, r, c):
    """A four-pointed sparkle."""
    d.polygon([(x, y - r), (x + r / 4, y - r / 4), (x + r, y), (x + r / 4, y + r / 4), (x, y + r), (x - r / 4, y + r / 4), (x - r, y), (x - r / 4, y - r / 4)], fill=c)


# ---- simple patterns, for the books with no print of their own ----------------
INKS = {'gold': (226, 182, 72, 255), 'ink': (45, 32, 26, 255), 'silver': (214, 220, 228, 255)}
PATTERNS = ['frame', 'corners', 'bands', 'title', 'star', 'moon', 'rune', 'rings', 'lattice', 'diamond']


def pattern(kind, ink, w=W, h=H):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c, m, lw = INKS[ink], w * 0.08, max(3, w // 40)
    cx, cy = w / 2, h / 2
    if kind in ('frame', 'star', 'moon', 'rune', 'diamond'):   # a ruled border round the cover
        d.rectangle([m, m, w - m, h - m], outline=c, width=lw)
        if kind == 'frame':
            d.rectangle([m * 1.8, m * 1.8, w - m * 1.8, h - m * 1.8], outline=c, width=max(2, lw // 2))
            for x, y in [(m, m), (w - m, m), (m, h - m), (w - m, h - m)]:
                d.ellipse([x - lw * 2, y - lw * 2, x + lw * 2, y + lw * 2], fill=c)
    if kind == 'corners':   # metal corner brackets and a small boss
        L = w * 0.28
        for sx, sy in [(0, 0), (1, 0), (0, 1), (1, 1)]:
            x, y = (w - m if sx else m), (h - m if sy else m)
            dx, dy = (-1 if sx else 1), (-1 if sy else 1)
            d.polygon([(x, y), (x + dx * L, y), (x + dx * L * 0.6, y + dy * lw * 2.5), (x + dx * lw * 2.5, y + dy * lw * 2.5),
                       (x + dx * lw * 2.5, y + dy * L * 0.6), (x, y + dy * L)], fill=c)
        d.ellipse([cx - w * 0.09, cy - w * 0.09, cx + w * 0.09, cy + w * 0.09], fill=c)
    if kind == 'bands':   # raised bands across, as on an old leather binding
        for f in (0.12, 0.2, 0.8, 0.88):
            d.rectangle([0, h * f - lw, w, h * f + lw], fill=c)
    if kind == 'title':   # a title plate with lines of lettering
        d.rectangle([w * 0.18, h * 0.16, w * 0.82, h * 0.42], outline=c, width=lw)
        for i, f in enumerate((0.24, 0.31)):
            d.rectangle([w * (0.28 + 0.06 * i), h * f, w * (0.72 - 0.06 * i), h * f + lw * 1.5], fill=c)
        d.rectangle([w * 0.3, h * 0.78, w * 0.7, h * 0.78 + lw], fill=c)
    if kind == 'star':
        r, pts = w * 0.28, []
        for i in range(10):
            a = -math.pi / 2 + i * math.pi / 5
            rr = r if i % 2 == 0 else r * 0.42
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        d.polygon(pts, fill=c)
    if kind == 'moon':
        r = w * 0.26
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
        d.ellipse([cx - r * 0.55, cy - r * 1.05, cx + r * 1.35, cy + r * 0.85], fill=(0, 0, 0, 0))
        for x, y, s_ in [(0.7, 0.25, 7), (0.78, 0.72, 5), (0.28, 0.75, 6)]:
            star(d, w * x, h * y, s_ * w / 120, c)
    if kind == 'rune':   # an angular glyph
        g = [(0.5, 0.25), (0.5, 0.75)], [(0.5, 0.35), (0.7, 0.48)], [(0.5, 0.52), (0.3, 0.64)], [(0.32, 0.3), (0.5, 0.42)]
        for (x0, y0), (x1, y1) in g:
            d.line([(w * x0, h * y0), (w * x1, h * y1)], fill=c, width=lw * 2)
    if kind == 'rings':   # interlocking rings
        r = w * 0.17
        for dx in (-0.6, 0.6):
            d.ellipse([cx + dx * r - r, cy - r, cx + dx * r + r, cy + r], outline=c, width=lw)
        d.ellipse([cx - r * 0.3, cy - r * 1.6, cx + r * 0.3, cy - r * 1.0], fill=c)
    if kind == 'lattice':   # a diamond trellis
        step = w / 4
        for k in range(-6, 10):
            d.line([(k * step, 0), (k * step + h * 0.6, h)], fill=c, width=max(2, lw // 2))
            d.line([(k * step, 0), (k * step - h * 0.6, h)], fill=c, width=max(2, lw // 2))
    if kind == 'diamond':
        r = w * 0.22
        d.polygon([(cx, cy - r * 1.4), (cx + r, cy), (cx, cy + r * 1.4), (cx - r, cy)], outline=c, width=lw)
        d.polygon([(cx, cy - r * 0.6), (cx + r * 0.42, cy), (cx, cy + r * 0.6), (cx - r * 0.42, cy)], fill=c)
    return im


def pages(w=336, h=216):
    """An open book's two pages of lettering (the book lies open: both pages up)."""
    rnd = random.Random(4)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ink = (60, 45, 35, 230)
    for x0 in (w * 0.08, w * 0.56):
        for y in range(int(h * 0.14), int(h * 0.86), 13):
            x = x0
            while x < x0 + w * 0.36:
                wd = rnd.uniform(8, 24)
                d.rectangle([x, y, min(x + wd, x0 + w * 0.36), y + 4], fill=ink)
                x += wd + 6
    return im


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    red, green, navy, blue, yellow = (190, 30, 40), (30, 110, 60), (25, 35, 90), (40, 80, 170), (240, 210, 60)
    prints = {
        'plaid': checks([(red, 24), (navy, 10), (red, 8), (green, 14)], over=((235, 235, 235, 255), 56, 30)),
        'tartan': checks([(green, 22), (blue, 16), (green, 8), (navy, 12)], over=(yellow + (255,), 58, 41)),
        'rainbow': rainbow(), 'psychedelic': psychedelic(), 'colorful': colorful(),
        'mottled': blotches(14, 10, 22, (40, 30, 20, 120), 11),
        'spiral': spiral(), 'stapled': stapled(),
    }
    for name, im in prints.items():
        im.save(os.path.join(OUT, f'book-{name}.png'))
    for kind in PATTERNS:
        for ink in INKS:
            pattern(kind, ink).save(os.path.join(OUT, f'book-pat-{kind}-{ink}.png'))
    pages().save(os.path.join(OUT, 'book-pages.png'))
    print('book prints:', ', '.join(prints), '+', len(PATTERNS) * len(INKS), 'patterns, pages')

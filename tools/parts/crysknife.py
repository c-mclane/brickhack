#!/usr/bin/env python3
"""LEGO part 5685, "Minifig Weapon Dagger / Knife Curved" (2024: Paul's
crysknife from the Dune Atreides Royal Ornithopter), modelled by hand for
our own use: it's too new for the LDraw library (when LDraw has it, theirs is
used instead: ldraw2glb.EXTRA).

  crysknife.py   -> ldraw-extra/parts/5685.dat

LDraw units, -Y up, as a held sword is: the handle along Y (y = 0 at the
foot of the collar), the blade above. The handle is one turned profile
(LATHE); the blade a broad curved claw (SPINE, EDGE: its back on +Z, its
cutting edge on -Z), faceted, thick at the back, thinning to the edge; its
flats face +-X.
"""
import math, os

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'ldraw-extra', 'parts', '5685.dat')
f = lambda v: f'{v:.3f}'.rstrip('0').rstrip('.') if abs(v) > 1e-9 else '0'

# Traced from a photo of the part (its grip 8 LDU across): the handle about
# 22 LDU (a collar, eight ribs, a rounded knob with a hole in the end), the
# blade about as long again, broad (some 13 LDU at its widest), bellying out
# low on one side and running nearly straight to the point on the other.

# the handle's profile, top to bottom: (radius, y)
LATHE = [(3.6, -3.0), (4.5, -2.6), (4.6, -1.0), (4.4, 0.0), (3.5, 0.4)]   # the collar
for i in range(8):  # eight ribs round the grip
    y0 = 0.6 + i * 1.55
    LATHE += [(3.4, y0), (4.0, y0 + 0.35), (4.0, y0 + 0.95), (3.4, y0 + 1.3)]
LATHE += [(3.5, 13.2), (4.3, 13.8), (4.6, 15.0), (4.5, 16.2), (4.0, 17.0), (3.0, 17.5), (1.6, 17.6)]  # the rounded knob

# the blade's outline, base to point: (z, y) along its back (nearly straight,
# drifting a little toward the point's side), and along its cutting edge
# (bellying out low, then running up to the point)
SPINE = [(3.4, -0.6), (3.0, -3.0), (1.1, -9.0), (1.6, -14.6), (2.3, -19.2), (3.0, -23.9), (3.7, -27.5)]
EDGE = [(-4.3, -0.6), (-5.6, -3.1), (-8.6, -6.8), (-11.2, -11.8), (-5.1, -18.7), (-1.7, -22.0), (0.8, -24.7), (3.7, -27.5)]
TIP_Y = -27.5
# (its base set right down into the collar, as wide as it, so they meet fully;
# and the blade drawn a little taller than traced: TALL times, from the collar)
TALL = 1.15
SPINE = [(z, y if y > -3 else -3 + (y + 3) * TALL) for z, y in SPINE]
EDGE = [(z, y if y > -3 else -3 + (y + 3) * TALL) for z, y in EDGE]
TIP_Y = -3 + (TIP_Y + 3) * TALL


def quad(a, b, c, d):
    return '4 16 ' + ' '.join(f(v) for p in (a, b, c, d) for v in p)


def tri(a, b, c):
    return '3 16 ' + ' '.join(f(v) for p in (a, b, c) for v in p)


def lathe(profile, n=16):
    out = []
    ring = lambda r, y: [(r * math.cos(2 * math.pi * k / n), y, r * math.sin(2 * math.pi * k / n)) for k in range(n)]
    rings = [ring(r, y) for r, y in profile]
    for a, b in zip(rings, rings[1:]):
        for k in range(n):
            out.append(quad(a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    for rg, (r, y) in ((rings[0], profile[0]), (rings[-1], profile[-1])):  # the ends, closed
        for k in range(n):
            out.append(tri((0, y, 0), rg[k], rg[(k + 1) % n]))
    return out


def along(points, y):
    """z of an outline (points base to point, y falling) at height y."""
    for (z0, y0), (z1, y1) in zip(points, points[1:]):
        if y1 <= y <= y0:
            t = (y0 - y) / (y0 - y1) if y0 != y1 else 0
            return z0 + (z1 - z0) * t
    return points[-1][0]


def blade(n=20):
    """The blade, slice by slice: on each face a flat by the back, a ridge, and a
    bevel down to the cutting edge (the faceting the real one has)."""
    out = []
    y0 = SPINE[0][1]
    S = []
    for i in range(n + 1):
        t = i / n
        y = y0 + (TIP_Y - y0) * t
        zs, ze = along(SPINE, y), along(EDGE, y)
        th = 0.95 * (1 - t) ** 1.4 + 0.03         # its thickness, tapering away to a fine point
        zr = zs + (ze - zs) * 0.45                # the ridge, a little nearer the back
        S.append([(th, y, zs), (th * 0.85, y, zr), (0.04, y, ze), (-0.04, y, ze), (-th * 0.85, y, zr), (-th, y, zs)])   # (a keen edge)
    for a, b in zip(S, S[1:]):
        for k in range(6):   # round the section: back, ridge, edge, edge, ridge, back
            out.append(quad(a[k], a[(k + 1) % 6], b[(k + 1) % 6], b[k]))
    s0 = S[0]
    out += [quad(s0[0], s0[1], s0[4], s0[5]), quad(s0[1], s0[2], s0[3], s0[4])]   # into the collar
    return out


def main():
    L = ['0 Minifig Weapon Dagger / Knife Curved (Crysknife)',
         '0 Name: 5685.dat',
         '0 Author: BrickHack (modelled after the 2024 part, for our own use)',
         '0 !LDRAW_ORG Unofficial_Part',
         '0 BFC NOCERTIFY',
         '0 !KEYWORDS Dune, crysknife, Paul Atreides, BrickLink 5685',
         '']
    L += lathe(LATHE)
    L += blade()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w').write('\n'.join(L) + '\n')
    print(f'{OUT}: {len(L)} lines')


if __name__ == '__main__':
    main()

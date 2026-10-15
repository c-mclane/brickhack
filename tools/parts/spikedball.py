#!/usr/bin/env python3
"""LEGO part 24084, "Minifig, Weapon Spiked Ball / Flail / Mace" (2016,
Nexo Knights; rubber), modelled by hand for our own use: it isn't in the
LDraw library (when LDraw has it, theirs is used instead: ldraw2glb.EXTRA).

  spikedball.py   -> ldraw-extra/parts/24084.dat

LDraw units, -Y up. About 1.4 x 1.3 x 1.1 cm (35 x 32 x 28 LDU) with its
spikes: a ball with a ring of spikes round its middle, more above and
below, and one on top; a bar hole runs up into it from below (a bar's end
goes in at the bottom: its origin is the ball's centre, the hole's mouth
at y = BALL).
"""
import math, os

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'ldraw-extra', 'parts', '24084.dat')
f = lambda v: f'{v:.3f}'.rstrip('0').rstrip('.') if abs(v) > 1e-9 else '0'

BALL = 10.0      # the ball's radius
SPIKE = 7.0      # how far a spike stands out of it
SPIKE_R = 3.0    # a spike's radius at its base
HOLE = 4.0       # the bar hole's radius (a bar is 8 LDU across)

# where the spikes point: (elevation above the middle, how many round, their turn)
RINGS = [(0, 8, 0), (45, 6, 30), (-45, 6, 0)]


def quad(a, b, c, d):
    return '4 16 ' + ' '.join(f(v) for p in (a, b, c, d) for v in p)


def tri(a, b, c):
    return '3 16 ' + ' '.join(f(v) for p in (a, b, c) for v in p)


def sph(r, el, az):
    """A point on a sphere of radius r: elevation and azimuth in degrees (-Y up)."""
    e, a = math.radians(el), math.radians(az)
    return (r * math.cos(e) * math.cos(a), -r * math.sin(e), r * math.cos(e) * math.sin(a))


def ball(nlat=10, nlon=16):
    """The ball, open at the bottom where the bar goes in."""
    out = []
    bottom = -90 + math.degrees(math.asin(HOLE / BALL))   # the hole's rim
    lats = [90 - 180 * i / nlat for i in range(nlat)] + [bottom]
    lats = [l for l in lats if l >= bottom]
    for la, lb in zip(lats, lats[1:]):
        for k in range(nlon):
            a0, a1 = 360 * k / nlon, 360 * (k + 1) / nlon
            out.append(quad(sph(BALL, la, a0), sph(BALL, la, a1), sph(BALL, lb, a1), sph(BALL, lb, a0)))
    # the hole: a short tube up into the ball, closed at its top
    y0, y1 = -sph(BALL, bottom, 0)[1], -2.0
    for k in range(nlon):
        a0, a1 = 2 * math.pi * k / nlon, 2 * math.pi * (k + 1) / nlon
        p = lambda a, y: (HOLE * math.cos(a), y, HOLE * math.sin(a))
        out.append(quad(p(a1, -y0), p(a0, -y0), p(a0, -y1), p(a1, -y1)))
        out.append(tri((0, -y1, 0), p(a1, -y1), p(a0, -y1)))
    return out


def spike(el, az, n=8):
    """A cone standing out of the ball, toward (el, az)."""
    tip = sph(BALL + SPIKE, el, az)
    d = [v / (BALL + SPIKE) for v in tip]
    # two directions across the spike
    u = (0, 1, 0) if abs(d[1]) < 0.9 else (1, 0, 0)
    a = (d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0])
    la = math.sqrt(sum(v * v for v in a))
    a = [v / la for v in a]
    b = (d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0])
    base = [v * (BALL - 1) for v in d]   # (set a little into the ball)
    ring = [tuple(base[i] + SPIKE_R * (math.cos(2 * math.pi * k / n) * a[i] + math.sin(2 * math.pi * k / n) * b[i])
                  for i in range(3)) for k in range(n)]
    return [tri(tip, ring[k], ring[(k + 1) % n]) for k in range(n)]


def main():
    L = ['0 Minifig Weapon Spiked Ball / Flail / Mace',
         '0 Name: 24084.dat',
         '0 Author: BrickHack (modelled after the 2016 part, for our own use)',
         '0 !LDRAW_ORG Unofficial_Part',
         '0 BFC NOCERTIFY',
         '0 !KEYWORDS mace, flail, morning star, Nexo Knights, BrickLink 24084',
         '']
    L += ball()
    for el, n, turn in RINGS:
        for k in range(n):
            L += spike(el, turn + 360 * k / n)
    L += spike(90, 0)   # one on top
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w').write('\n'.join(L) + '\n')
    print(f'{OUT}: {len(L)} lines')


if __name__ == '__main__':
    main()

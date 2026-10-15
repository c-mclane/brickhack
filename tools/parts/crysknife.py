#!/usr/bin/env python3
"""LEGO part 5685, "Minifig Weapon Dagger / Knife Curved" (2024: Paul's
crysknife from the Dune Atreides Royal Ornithopter), modelled by hand for
our own use: it's too new for the LDraw library (when LDraw has it, theirs is
used instead: ldraw2glb.EXTRA).

  crysknife.py   -> ldraw-extra/parts/5685.dat

LDraw units, -Y up, like a held sword: the grip along Y (its ribbed grip from
y = 0 down to its knob with a hole through it), a ring guard on top, and the
blade above it, broad, sweeping forward (+Z) to its point, a thick spine at
its back, thinning to the cutting edge; its flat faces +-X.
"""
import os

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'ldraw-extra', 'parts', '5685.dat')
f = lambda v: f'{v:.3f}'.rstrip('0').rstrip('.')


def prim(name, x, y, z, rx, ry, rz):
    """A primitive (unit size, along +Y), scaled: rx, rz the radius, ry the height."""
    return f'1 16 {f(x)} {f(y)} {f(z)} {f(rx)} 0 0 0 {f(ry)} 0 0 0 {f(rz)} {name}'


def tri(a, b, c):
    return '3 16 ' + ' '.join(f(v) for p in (a, b, c) for v in p)


def quad(a, b, c, d):
    return '4 16 ' + ' '.join(f(v) for p in (a, b, c, d) for v in p)


def main():
    L = ['0 Minifig Weapon Dagger / Knife Curved (Crysknife)',
         '0 Name: 5685.dat',
         '0 Author: BrickHack (modelled after the 2024 part, for our own use)',
         '0 !LDRAW_ORG Unofficial_Part',
         '0 BFC NOCERTIFY',
         '0 !KEYWORDS Dune, crysknife, Paul Atreides, BrickLink 5685',
         '']
    # the guard: a ring collar on top of the grip (y -3 .. 0)
    L += [prim('4-4cyli.dat', 0, -3, 0, 5.5, 3, 5.5), prim('4-4disc.dat', 0, -3, 0, 5.5, 1, 5.5), prim('4-4disc.dat', 0, 0, 0, 5.5, 1, 5.5)]
    # the grip (y 0 .. 22), ribbed: five raised rings
    L += [prim('4-4cyli.dat', 0, 0, 0, 3.6, 22, 3.6)]
    for y in (3, 7, 11, 15, 19):
        L += [prim('4-4cyli.dat', 0, y, 0, 4.4, 1.6, 4.4), prim('4-4ring4.dat', 0, y, 0, 0.88, 1, 0.88), prim('4-4ring4.dat', 0, y + 1.6, 0, 0.88, 1, 0.88)]
    # the knob at the end (y 22 .. 25), a hole through it
    L += [prim('4-4cyli.dat', 0, 22, 0, 4.2, 3, 4.2), prim('4-4ring1.dat', 0, 25, 0, 2.1, 1, 2.1),
          prim('4-4cyli.dat', 0, 23, 0, 2.1, 2, 2.1), prim('4-4disc.dat', 0, 23, 0, 2.1, 1, 2.1)]
    # the blade: N slices from the guard (t 0, y -3) to the point (t 1, y -50)
    N = 14
    def slice_(t):
        y = -3 - 47 * t
        spine = -3.5 + 15.5 * t * t           # its back, curving forward
        edge = 4.5 + 10 * t - 2.5 * t * t     # its cutting edge, bellied, meeting the spine at the point
        thick = 1.6 * (1 - t) + 0.25 * t      # thinner toward the point
        return [(thick, y, spine), (-thick, y, spine), (0.3 * (1 - t), y, edge), (-0.3 * (1 - t), y, edge)]
    S = [slice_(i / N) for i in range(N + 1)]
    for a, b in zip(S, S[1:]):
        (sp, sm, ep, em), (sp2, sm2, ep2, em2) = a, b
        L += [quad(sp, ep, ep2, sp2), quad(sm, sm2, em2, em),     # the flats
              quad(sp, sp2, sm2, sm), quad(ep, em, em2, ep2)]     # the spine, the edge
    sp, sm, ep, em = S[0]
    L += [quad(sp, sm, em, ep)]                                   # where it meets the guard
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w').write('\n'.join(L) + '\n')
    print(f'{OUT}: {len(L)} lines')


if __name__ == '__main__':
    main()

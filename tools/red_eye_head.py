"""An evil wizard's head: the scowling head print 3626bp0f (angry eyebrows, tense mouth), its one eye (the figure's
left, on the right as you face it) glowing red. Every line of it copied as it is, but that eye, black and glint, made
a glowing trans red.

usage: python3 tools/red_eye_head.py   (writes ldraw-extra/parts/3626bp0fr.dat)
"""
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'vendor/ldraw/ldraw/parts/3626bp0f.dat')
OUT = os.path.join(ROOT, 'ldraw-extra/parts/3626bp0fr.dat')
RED = 36   # (trans red: it glows)
EYE = (3.6, 9.4, 1.6, 1.35)   # (the eye, under its brow: an oval, its middle and half-widths; LDraw units, the head's own frame; -Z its face)


def in_eye(pts):
    x = sum(p[0] for p in pts) / len(pts); y = sum(p[1] for p in pts) / len(pts); z = sum(p[2] for p in pts) / len(pts)
    cx, cy, rx, ry = EYE
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.05 and z < 0


def main():
    out = ['0 Minifig Head with Angry Eyebrows, Tense Mouth and One Red Eye Pattern (an evil wizard\'s)', '0 Name: 3626bp0fr.dat',
           '0 Author: brickhack', '0 BFC NOCERTIFY', '']
    n = 0
    for line in open(SRC, encoding='latin-1').read().splitlines():
        t = line.split()
        if not t or t[0] == '0':
            continue
        if t[0] in '34' and t[1] in ('0', '15'):   # (the eye's black and its white glint: all of it)
            k = int(t[0]); v = list(map(float, t[2:2 + 3 * k]))
            if in_eye([v[i:i + 3] for i in range(0, 3 * k, 3)]):
                t[1] = str(RED); n += 1
        out.append(' '.join(t))
    open(OUT, 'w').write('\n'.join(out) + '\n')
    print(f'{OUT}: {n} faces of the eye made red')


if __name__ == '__main__':
    main()

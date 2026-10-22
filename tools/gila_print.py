"""The gila monster's print: the chameleon (15678) flattened into one file, every face its own colour, black with
orange blotches running in crossbands down the body and rings round the tail, the head and the legs black.
Faces split small first so the blotches are round, not the shape of the mesh.

usage: python3 tools/gila_print.py   (writes ldraw-extra/parts/15678pg1.dat)
"""
import math, os
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LIB = os.path.join(ROOT, 'vendor/ldraw/ldraw')
OUT = os.path.join(ROOT, 'ldraw-extra/parts/15678pg1.dat')
BLACK, ORANGE = 0, 25
STEP = 2.4  # LDU: the longest edge a face is split down to


def load(name):
    for d in ('parts', 'p'):
        p = os.path.join(LIB, d, name.replace('\\', '/').lower())
        if os.path.exists(p):
            return open(p).read().splitlines()
    raise FileNotFoundError(name)


def flat(name, M=np.eye(4), out=None):
    out = [] if out is None else out
    for line in load(name):
        t = line.split()
        if not t:
            continue
        if t[0] == '1':
            v = list(map(float, t[2:14]))
            m = np.array([[v[3], v[4], v[5], v[0]], [v[6], v[7], v[8], v[1]], [v[9], v[10], v[11], v[2]], [0, 0, 0, 1]])
            flat(t[14], M @ m, out)
        elif t[0] in '34':
            n = int(t[0])
            pts = (M[:3, :3] @ np.array(list(map(float, t[2:2 + 3 * n]))).reshape(n, 3).T).T + M[:3, 3]
            out.append(pts[[0, 1, 2]])
            if n == 4:
                out.append(pts[[0, 2, 3]])
    return out


def split(tri):
    a, b, c = tri
    if max(np.linalg.norm(a - b), np.linalg.norm(b - c), np.linalg.norm(c - a)) <= STEP:
        return [tri]
    ab, bc, ca = (a + b) / 2, (b + c) / 2, (c + a) / 2
    return [f for t in ([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]) for f in split(np.array(t))]


def colour(p):
    x, y, z = p
    # (the head is -z, the tail +z curling up; y down, 0 the feet)
    if z < -23 or y > -6:
        return BLACK  # the head; the legs and the belly
    if z > 15:  # the tail: rings, a little wavy
        return ORANGE if math.sin(z * 0.85 + 0.5 * math.sin(x * 0.6)) > 0.15 else BLACK
    # the body: crossbands broken into blotches, a black net between
    band = math.sin(z * 0.55 + 0.9 * math.sin(x * 0.45 + y * 0.2))
    blot = math.sin(x * 0.9 + z * 0.35) * math.sin(y * 0.8 - z * 0.6 + x * 0.3)
    return ORANGE if band + 0.75 * blot > 0.05 else BLACK


def main():
    faces = [f for t in flat('15678.dat') for f in split(t)]
    lines = ['0 Animal Chameleon with Gila Monster Pattern', '0 Name: 15678pg1.dat', '0 Author: brickhack',
             '0 BFC NOCERTIFY', '']
    for f in faces:
        c = colour(f.mean(axis=0))
        lines.append(f'3 {c} ' + ' '.join(f'{v:.2f}' for v in f.reshape(-1)))
    open(OUT, 'w').write('\n'.join(lines) + '\n')
    print(f'{OUT}: {len(faces)} faces')


if __name__ == '__main__':
    main()

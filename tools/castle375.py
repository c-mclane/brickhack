"""The yellow castle of 1978 (set 375, after its instruction book, 03752), in chrome gold, for Ascend's meadow:
items.json "_castle375". Laid brick by brick in the book's own order, each brick where its step's drawing shows it.

The base is 32x32 studs (a 16x32 baseplate down the middle, two 8x16 plates each side). A brick's place is given by
the studs it covers: (i0, j0) its corner stud, w studs along i (left to right), d along j (back to front, the gate at
the front, j = 31), its underside `yb` plates up (a brick is 3). In LDraw: x = (i - 16) * 20, z = (16 - j) * 20,
-y up (so the gate faces -z, LDraw's front).

usage: python3 tools/castle375.py   (writes the item into web/assets/brick/items.json)
"""
import json, os
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LIB = os.path.join(ROOT, 'vendor/ldraw/ldraw')
GOLD, GREEN, GREY, RED, WHITE, BLACK = 334, 2, 7, 4, 15, 0
BRICK = 3   # (plates to a brick)

_box = {}
def extent(part):  # (the part's extent, LDraw units, its own frame)
    if part in _box: return _box[part]
    def load(name):
        for d in ('parts', 'p'):
            p = os.path.join(LIB, d, name.replace('\\', '/').lower())
            if os.path.exists(p): return open(p, encoding='latin-1').read().splitlines()
        return []
    pts = []
    def flat(name, M):
        for l in load(name):
            t = l.split()
            if not t: continue
            if t[0] == '1':
                v = list(map(float, t[2:14]))
                m = np.array([[v[3], v[4], v[5], v[0]], [v[6], v[7], v[8], v[1]], [v[9], v[10], v[11], v[2]], [0, 0, 0, 1]])
                flat(' '.join(t[14:]), M @ m)
            elif t[0] in '34':
                n = int(t[0]); p = np.array(list(map(float, t[2:2 + 3 * n]))).reshape(n, 3)
                pts.append((M[:3, :3] @ p.T).T + M[:3, 3])
    flat(part + '.dat', np.eye(4))
    a = np.vstack(pts)
    _box[part] = (a.min(0), a.max(0))
    return _box[part]

def rot_y(deg):
    t = np.radians(deg); c, s = round(np.cos(t), 6), round(np.sin(t), 6)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

parts, steps = [], {}
STEP = ['']
def step(name): STEP[0] = name; steps.setdefault(name, len(parts))

def add(part, color, pos, R):
    parts.append({'part': part, 'color': color, 'pos': [round(float(v), 3) for v in pos],
                  'mat': [round(float(v), 4) for v in R.flatten()], 'step': STEP[0]})

OCC = {}   # (i, j) -> the plate levels filled there
def occupy(i0, j0, w, d, yb, h):
    for i in range(i0, i0 + w):
        for j in range(j0, j0 + d):
            OCC.setdefault((i, j), set()).update(range(yb, yb + h))
def free(i, j, yb, h=3): return not (OCC.get((i, j), set()) & set(range(yb, yb + h)))
def top(i, j): return max(OCC.get((i, j), {-1})) + 1   # (the plate level just over what's there)

def place(part, color, i0, j0, w, d, yb, deg=None):
    """part over studs [i0, i0+w) x [j0, j0+d), its underside yb plates up, turned deg about the vertical (by default
    its length along its run: 0 along i, 90 along j); centred on those studs by its own extent"""
    if deg is None: deg = 0 if w >= d else 90
    lo, hi = extent(part)
    occupy(i0, j0, w, d, yb, max(1, round((hi[1] - max(lo[1], 0)) / 8)))
    R = rot_y(deg)
    c = R @ np.array([(lo[0] + hi[0]) / 2, 0, (lo[2] + hi[2]) / 2])
    x = (i0 + w / 2 - 16) * 20 - c[0]
    z = (16 - j0 - d / 2) * 20 - c[2]
    add(part, color, (x, -yb * 8 - hi[1], z), R)

def at(part, color, u, v, yb, deg=0, top=24):
    """part with its own origin at the point (u, v) of the stud grid (u, v in studs, corners at whole numbers), its
    origin `top` LDU above its underside (a brick's origin is at its top: 24)"""
    add(part, color, ((u - 16) * 20, -yb * 8 - top, (16 - v) * 20), rot_y(deg))

def brick(i0, j0, w, d, yb, color=GOLD):
    """a plain brick over those studs: 1 x n or 2 x n"""
    n, m = max(w, d), min(w, d)
    part = {(1, 1): '3005', (1, 2): '3004', (1, 3): '3622', (1, 4): '3010', (1, 6): '3009', (1, 8): '3008',
            (2, 2): '3003', (2, 3): '3002'}[(m, n)]
    place(part, color, i0, j0, w, d, yb)

def plate(i0, j0, w, d, yb, color=GOLD):
    n, m = max(w, d), min(w, d)
    part = {(1, 1): '3024', (1, 2): '3023', (1, 3): '3623', (1, 4): '3710', (1, 8): '3460', (2, 2): '3022',
            (2, 3): '3021', (2, 4): '3020', (2, 6): '3795', (2, 8): '3034', (4, 6): '3032', (6, 8): '3036'}[(m, n)]
    place(part, color, i0, j0, w, d, yb)

def tile(i0, j0, w, d, yb, color=GOLD):
    place('3069b', color, i0, j0, w, d, yb)

def lay(cells, yb, color=GOLD, stagger=0):
    """one course of bricks over these cells (a set of (i, j)), each straight run in the longest bricks that fit, the
    side walls' runs along j first, then the rest along i; `stagger` shifts where the first joint falls"""
    cells = set(c for c in cells if free(*c, yb))
    def runs(along_j):
        out = []
        for c in sorted(cells, key=lambda c: (c[0], c[1]) if along_j else (c[1], c[0])):
            if c not in cells: continue
            k = 0
            while ((c[0], c[1] + k + 1) if along_j else (c[0] + k + 1, c[1])) in cells: k += 1
            if k >= 1 or not along_j: out.append((c, k + 1))
            for t in range(k + 1): cells.discard((c[0], c[1] + t) if along_j else (c[0] + t, c[1]))
        return out
    first = [r for r in runs(True) if r[1] >= 3] if True else []
    for (i, j), n in first + runs(False):
        along_j = (i, j + 1) in [(i, j + t) for t in range(1, n)] and n > 1 and any(r[0] == (i, j) for r in first)
        pos = 0
        sizes = []
        lead = (stagger + (j if along_j else i)) % 2
        if lead and n > 2: sizes.append(1 if n % 2 else 2); pos = sizes[0]
        while pos < n:
            left = n - pos
            for L in (8, 6, 4, 3, 2, 1):
                if L <= left and not (left - L == 5): break
            sizes.append(L); pos += L
        pos = 0
        for L in sizes:
            if along_j: brick(i, j + pos, 1, L, yb, color)
            else: brick(i + pos, j, L, 1, yb, color)
            pos += L

def hinge(u, v, side, yb):
    """a pair of hinge bricks (1x4 between them, base and top), their pivot at the point (u, v) of a wall's face:
    side 'front' (the bricks behind it, toward -j, the pivot on their +j face) or 'back' (the bricks before it); the top
    half (3830) to the +i of the pivot on a front face, to the -i on a back one"""
    deg = 0 if side == 'front' else 180
    occupy(u - 2, v if side == 'back' else v - 1, 4, 1, yb, 3)
    at('3830', GOLD, u, v, yb, deg)
    at('3831', GOLD, u, v, yb, deg)

# ---- 1: the base: the 16x32 baseplate down the middle, two 8x16 plates each side
step('1')
at('3857', GREEN, 16, 16, 0, 90, top=0)
for v in (8, 24):
    at('3865', GREEN, 4, v, 0, 90, top=0)
    at('3865', GREEN, 28, v, 0, 90, top=0)

# ---- 2: the first course, on the studs step 1 marks
step('2')
# the back: the left tower's corner, its hinge (pivot on the back face at stud line 8), the wall to the middle
brick(2, 2, 1, 2, 0); brick(2, 4, 1, 3, 0)
brick(3, 1, 4, 1, 0); brick(7, 1, 1, 1, 0)
hinge(8, 0, 'back', 0)
brick(10, 0, 3, 1, 0)
brick(14, 2, 4, 1, 0)
# and the right, as the left
brick(19, 0, 3, 1, 0)
hinge(24, 0, 'back', 0)
brick(24, 1, 1, 1, 0); brick(25, 1, 4, 1, 0)
brick(29, 2, 1, 2, 0); brick(29, 4, 1, 3, 0)
# the two pillars in the courtyard
brick(12, 6, 1, 2, 0); brick(19, 6, 1, 2, 0)
# the side walls, each in four lengths (the gaps between, for the buttresses)
for i in (2, 29):
    brick(i, 9, 1, 3, 0); brick(i, 12, 1, 2, 0)
    brick(i, 16, 1, 2, 0); brick(i, 18, 1, 3, 0)
    brick(i, 23, 1, 3, 0); brick(i, 26, 1, 2, 0)
# the rooms each side: a post, a wall and its step, a short wall nearer the front
brick(4, 15, 1, 1, 0); brick(6, 15, 4, 1, 0); brick(6, 16, 2, 1, 0); brick(6, 21, 2, 1, 0)
brick(27, 15, 1, 1, 0); brick(22, 15, 4, 1, 0); brick(24, 16, 2, 1, 0); brick(24, 21, 2, 1, 0)
# the front: the left tower's wall, its hinge (pivot on the front face at stud line 8), the gate's left block (a 2x3,
# a 2x2 plate on its inner four studs), the threshold (three tiles), the right block, the right hinge and tower wall
brick(3, 28, 4, 1, 0); brick(6, 29, 1, 2, 0)
hinge(8, 32, 'front', 0)
brick(10, 30, 1, 2, 0)
brick(10, 28, 3, 2, 0); plate(11, 28, 2, 2, 3)
for i in (13, 15, 17): tile(i, 29, 2, 1, 0)
brick(19, 28, 3, 2, 0); plate(19, 28, 2, 2, 3)
brick(21, 30, 1, 2, 0)
hinge(24, 32, 'front', 0)
brick(25, 28, 4, 1, 0); brick(25, 29, 1, 2, 0)

# ---- 3: the second course, each joint over a brick below; the buttresses on the right
step('3')
for (i, a, b) in ((2, 2, 5), (29, 2, 5)):   # (the corner walls: a 1x3 then a 1x2)
    brick(i, a, 1, 3, 3); brick(i, b, 1, 2, 3)
brick(3, 1, 3, 1, 3); brick(6, 0, 2, 2, 3); brick(8, 0, 3, 1, 3); brick(11, 0, 2, 1, 3)
brick(19, 0, 2, 1, 3); brick(21, 0, 3, 1, 3); brick(24, 0, 2, 2, 3); brick(26, 1, 3, 1, 3)
brick(12, 6, 1, 2, 3); brick(19, 6, 1, 2, 3)
for i in (2, 29):
    brick(i, 9, 1, 2, 3); brick(i, 11, 1, 3, 3)
    brick(i, 16, 1, 3, 3); brick(i, 19, 1, 2, 3)
    brick(i, 23, 1, 2, 3); brick(i, 25, 1, 3, 3)
brick(4, 15, 1, 1, 3); brick(6, 16, 2, 1, 3); brick(6, 21, 2, 1, 3)
brick(27, 15, 1, 1, 3); brick(24, 16, 2, 1, 3); brick(24, 21, 2, 1, 3)
# the front, each side: the tower's wall (a 1x3, a 1x4 down its side over the hinge, a 1x1, a 1x3), the gate's block
# (a 1x3 down its outer side; on the plate a 1x2 and a 1x2 with a pin hole, the hole across the gate)
brick(3, 28, 3, 1, 3); brick(6, 28, 1, 4, 3); brick(7, 31, 1, 1, 3); brick(8, 31, 3, 1, 3)
brick(10, 28, 1, 3, 3); brick(11, 28, 1, 2, 4); place('3700', GOLD, 12, 28, 1, 2, 4)
brick(26, 28, 3, 1, 3); brick(25, 28, 1, 4, 3); brick(24, 31, 1, 1, 3); brick(21, 31, 3, 1, 3)
brick(21, 28, 1, 3, 3); brick(20, 28, 1, 2, 4); place('3700', GOLD, 19, 28, 1, 2, 4)
# the buttresses down the right side (75-degree slopes, three bricks high): in the corners, double; in the gaps
SLOPE, CORNER = '3684a', '3685'
# (each its studs on the wall's line, its slope outward)
place(CORNER, GOLD, 29, 0, 2, 2, 0, -90)
for j in (7, 14, 21): place(SLOPE, GOLD, 29, j, 2, 2, 0, -90)
place(CORNER, GOLD, 29, 28, 2, 2, 0, 0)

# ---- 4: the third course, its arrow slits (a stud left out in each length of wall, and on the hinge lines), the posts
# of the back doorway (1x1x2 with shutter holders, facing in), the gate's blocks levelled with two 2x2 plates, the grey
# pins through the pin-hole bricks into the gateway; the buttresses on the left
step('4')
for (i, s2) in ((2, 1), (29, -1)):
    brick(i, 2, 1, 2, 6); brick(i, 5, 1, 2, 6)
    brick(i, 9, 1, 2, 6); brick(i, 12, 1, 2, 6)
    brick(i, 16, 1, 2, 6); brick(i, 19, 1, 2, 6)
    brick(i, 23, 1, 2, 6); brick(i, 26, 1, 2, 6)
brick(3, 1, 2, 1, 6); brick(6, 0, 2, 2, 6); brick(9, 0, 3, 1, 6); place('3581', GOLD, 12, 0, 1, 1, 6, 0)
brick(27, 1, 2, 1, 6); brick(24, 0, 2, 2, 6); brick(20, 0, 3, 1, 6); place('3581', GOLD, 19, 0, 1, 1, 6, 0)
brick(12, 6, 1, 2, 6); brick(19, 6, 1, 2, 6)
brick(4, 15, 1, 1, 6); brick(6, 16, 2, 1, 6); brick(6, 21, 2, 1, 6)
brick(27, 15, 1, 1, 6); brick(24, 16, 2, 1, 6); brick(24, 21, 2, 1, 6)
brick(3, 28, 2, 1, 6); brick(6, 28, 1, 3, 6); brick(6, 31, 2, 1, 6); brick(9, 31, 1, 1, 6); brick(10, 28, 1, 4, 6)
plate(11, 28, 2, 2, 7); plate(11, 28, 2, 2, 8)
brick(27, 28, 2, 1, 6); brick(25, 28, 1, 3, 6); brick(24, 31, 2, 1, 6); brick(22, 31, 1, 1, 6); brick(21, 28, 1, 4, 6)
plate(19, 28, 2, 2, 7); plate(19, 28, 2, 2, 8)
at('3673', GREY, 13, 29, 4, 0, top=14); at('3673', GREY, 19, 29, 4, 0, top=14)   # (the pins, half in their holes)
place(CORNER, GOLD, 1, 0, 2, 2, 0, 180)
for j in (7, 14, 21): place(SLOPE, GOLD, 1, j, 2, 2, 0, 90)
place(CORNER, GOLD, 1, 28, 2, 2, 0, 90)

# ---- 5: the fourth course: the slits carried up; over each tower's corner a 2x3, its inner studs overhanging; corbels
# (inverted slopes) along the tops of the walls, for the wall-walk; the red pin-hole bricks hung on the gate's pins
step('5')
def inv(i0, j0, w, d, toward):   # (an inverted slope over those studs, its foot on the wall, leaning `toward` +i/-i/+j/-j)
    part = '3660a' if w * d == 4 else '3665a'
    deg = {'-j': 0, '+i': 90, '+j': 180, '-i': -90}[toward]
    place(part, GOLD, i0, j0, w, d, 9, deg)
for (i, t, c0) in ((2, '+i', 3), (29, '-i', 27)):
    brick(i, 3, 1, 1, 9); brick(i, 5, 1, 4, 9)
    inv(min(i, i + (1 if t == '+i' else -1)), 9, 2, 2, t)
    brick(i, 12, 1, 6, 9); brick(i, 19, 1, 3, 9)
    inv(min(i, i + (1 if t == '+i' else -1)), 22, 2, 2, t)
    brick(i, 24, 1, 1, 9); brick(i, 26, 1, 1, 9)
brick(2, 1, 3, 2, 9); brick(6, 0, 2, 3, 9); inv(9, 0, 2, 2, '+j'); inv(11, 0, 1, 2, '+j')
brick(27, 1, 3, 2, 9); brick(24, 0, 2, 3, 9); inv(21, 0, 2, 2, '+j'); inv(20, 0, 1, 2, '+j')
brick(12, 6, 1, 2, 9); brick(19, 6, 1, 2, 9)
brick(4, 15, 1, 1, 9)
brick(27, 15, 1, 1, 9)
brick(2, 27, 3, 2, 9); brick(6, 28, 1, 4, 9); inv(7, 28, 2, 2, '-j'); brick(7, 31, 3, 1, 9)
brick(27, 27, 3, 2, 9); brick(25, 28, 1, 4, 9); inv(23, 28, 2, 2, '-j'); brick(22, 31, 3, 1, 9)
brick(10, 28, 3, 1, 9); brick(10, 29, 1, 3, 9); brick(11, 29, 2, 1, 9)
brick(19, 28, 3, 1, 9); brick(21, 29, 1, 3, 9); brick(19, 29, 2, 1, 9)
place('3700', RED, 13, 28, 1, 2, 4); place('3700', RED, 18, 28, 1, 2, 4)

# ---- 6: the grey wall-walk on the corbels, the outer row of each wall left yellow (for its battlements); the red
# slopes on the drawbridge's red bricks
step('6')
for (a, b) in ((3, 28), ):   # (each side's walk: down the side wall, along the back, along the front)
    pass
def walk(i0, j0, w, d, yb=12):
    plate(i0, j0, w, d, yb, GREY)
for mir in (False, True):
    X = (lambda i, w: 32 - i - w) if mir else (lambda i, w: i)
    walk(X(3, 2), 3, 2, 8); walk(X(3, 2), 11, 2, 6)
    walk(X(5, 4), 1, 4, 2); walk(X(9, 4), 0, 4, 2)
    plate(X(3, 2), 21, 2, 2, 12, GREY); plate(X(3, 2), 21, 2, 2, 13, GREY)
    walk(X(3, 2), 23, 2, 4); walk(X(5, 3), 26, 3, 2); walk(X(6, 4), 28, 4, 2)
place('3040b', RED, 13, 28, 1, 2, 7, 180); place('3040b', RED, 18, 28, 1, 2, 7, 180)

# ---- 7: the fifth course round the outside of the walls (the hinges again at the corners of the two towers' wall
# sections), the pillars up a course; over each side room an arch on its posts, grey plates from the walk to its top
step('7')
hinge(8, 0, 'back', 12); hinge(24, 0, 'back', 12); hinge(8, 32, 'front', 12); hinge(24, 32, 'front', 12)
ring = set()
for j in range(1, 29): ring |= {(2, j), (29, j)}
for i in list(range(2, 6)) + list(range(26, 30)): ring |= {(i, 1), (i, 28)}
for i in list(range(6, 13)) + list(range(19, 26)): ring |= {(i, 0), (i, 31)}
ring |= {(6, j) for j in range(28, 31)} | {(25, j) for j in range(28, 31)}
ring |= {(i, j) for i in (10, 11, 12, 19, 20, 21) for j in (28, 29, 30)}
ring |= {(i, 1) for i in (3, 4, 27, 28)} | {(i, 2) for i in (3, 4, 27, 28)}
ring |= {(6, 1), (7, 1), (6, 2), (7, 2), (24, 1), (25, 1), (24, 2), (25, 2)}
lay(ring, 12)
brick(12, 6, 1, 2, 12); brick(19, 6, 1, 2, 12)
for mir in (False, True):
    X = (lambda i, w: 32 - i - w) if mir else (lambda i, w: i)
    place('3307', GOLD, X(6, 1), 16, 1, 6, 9)
    plate(X(3, 2), 16, 2, 1, 13, GREY); plate(X(3, 2), 16, 2, 1, 14, GREY); plate(X(3, 4), 16, 4, 1, 15, GREY)
    plate(X(3, 2), 21, 2, 1, 14, GREY); plate(X(3, 4), 21, 4, 1, 15, GREY)
    plate(X(4, 2), 12, 2, 1, 13, GREY); plate(X(4, 2), 12, 2, 1, 14, GREY)

# ---- 8: the sixth course round the outside; the great red doors hung on the shutter holders of the back doorway
# (closed, meeting in its middle); the side rooms roofed in grey (a 4x6 plate each)
step('8')
lay(ring, 15)
brick(12, 6, 1, 2, 15); brick(19, 6, 1, 2, 15)
at('3644', RED, 12.5, 0.95, 18, 90, top=0); at('3644', RED, 19.5, 0.95, 18, -90, top=0)
for mir in (False, True):
    X = (lambda i, w: 32 - i - w) if mir else (lambda i, w: i)
    plate(X(3, 4), 16, 4, 6, 16, GREY)

# ---- 9: the battlements along the outside (1x2 merlons, a stud's crenel between; 2x2 at the corners; solid where the
# side towers will stand); over the doorway a 1x8 plate each side from the back wall to its pillar, a black grille on
# each
step('9')
B = 18
for mir in (False, True):
    X = (lambda i, w: 32 - i - w) if mir else (lambda i, w: i)
    for (j0, w0) in ((1, 1), (27, 1)):   # (the corners, back and front)
        brick(X(2, 2), j0, 2, 2, B)
    I = X(2, 1)
    for j in (4, 7, 10, 13): brick(I, j, 1, 2, B)
    brick(I, 16, 1, 8, B); brick(I, 24, 1, 2, B)
    brick(X(5, 2), 1, 2, 1, B); brick(X(8, 2), 0, 2, 1, B); brick(X(11, 1), 0, 1, 1, B)
    brick(X(5, 2), 28, 2, 1, B); brick(X(8, 2), 31, 2, 1, B)
    plate(X(12, 1), 0, 1, 8, B)
    place('3185', BLACK, X(12, 1), 1, 1, 4, B + 1, 90)


# ---- 10: the three towers, each built apart (pages 11-14) and set on the walls: the tall blue one astride the back
# doorway on its two lintels, the red one on the left room, the yellow one on the right
def parapet(i0, j0, n, yb, floor=True):
    """a tower's crown: a ring of bricks n+2 square a stud out over its walls (on black corbels), a grey floor inside,
    merlons on the ring (2x2 at the corners, a 1x2 in the middle of each side)"""
    m = n + 2; a, b = i0 - 1, j0 - 1
    for (i, j, w, d) in ((a, b, m, 1), (a, b + m - 1, m, 1), (a, b + 1, 1, m - 2), (a + m - 1, b + 1, 1, m - 2)):
        L = max(w, d)
        k = 0
        while k < L:
            seg = min(8 if L - k != 9 else 6, L - k) if L - k not in (5, 7) else (3 if L - k == 5 else 4)
            seg = {5: 3, 7: 4}.get(seg, seg)
            if w > 1: brick(i + k, j, seg, 1, yb)
            else: brick(i, j + k, 1, seg, yb)
            k += seg
    if floor:
        plate(i0, j0, 4, n, yb, GREY) if n == 6 else None
        if n == 6: plate(i0 + 4, j0, 2, n, yb, GREY)
    for (i, j) in ((a, b), (a + m - 2, b), (a, b + m - 2), (a + m - 2, b + m - 2)):
        brick(i, j, 2, 2, yb + 3)
    mid = a + m // 2 - 1
    brick(mid, b, 2, 1, yb + 3); brick(mid, b + m - 1, 2, 1, yb + 3)
    mid = b + m // 2 - 1
    brick(a, mid, 1, 2, yb + 3); brick(a + m - 1, mid, 1, 2, yb + 3)

def corbels(i0, j0, n, yb):
    """the course under a crown: a ring of the shaft's wall, two black 1x2 inverted slopes leaning out of each side (a
    stud in from its corners), yellow between"""
    e, f = i0 + n - 1, j0 + n - 1
    for (i, j, t) in ((i0 + 1, j0, '-j'), (e - 1, j0, '-j'), (i0 + 1, f, '+j'), (e - 1, f, '+j'),
                      (i0, j0 + 1, '-i'), (i0, f - 1, '-i'), (e, j0 + 1, '+i'), (e, f - 1, '+i')):
        deg = {'-j': 0, '+i': 90, '+j': 180, '-i': -90}[t]
        di, dj = {'-j': (0, -1), '+j': (0, 1), '-i': (-1, 0), '+i': (1, 0)}[t]
        place('3665a', BLACK, min(i, i + di), min(j, j + dj), 1 + abs(di), 1 + abs(dj), yb, deg)
    for (i, j) in ((i0, j0), (e, j0), (i0, f), (e, f)): brick(i, j, 1, 1, yb)
    brick(i0 + 2, j0, n - 4, 1, yb); brick(i0 + 2, f, n - 4, 1, yb)
    brick(i0, j0 + 2, 1, n - 4, yb); brick(e, j0 + 2, 1, n - 4, yb)

def small_tower(i0, j0, yb):
    """the red and yellow towers: 6x6, slit walls left and right, an arch (1x6x2) front and back, corbels, the crown"""
    n = 6
    for k in range(2):   # (the legs: the side walls, full, the arches' feet)
        y = yb + 3 * k
        for i in (i0, i0 + n - 1):
            if k == 0: brick(i, j0, 1, 2, y); brick(i, j0 + 2, 1, 1, y); brick(i, j0 + 4, 1, 2, y)   # (a slit in it)
            else: brick(i, j0, 1, 3, y); brick(i, j0 + 3, 1, 3, y)
    for k in range(2, 4):
        y = yb + 3 * k
        for i in (i0, i0 + n - 1):
            if k == 2: brick(i, j0 + 1, 1, 1, y); brick(i, j0 + 3, 1, 2, y)
            else: brick(i, j0 + 1, 1, 4, y)
    for j in (j0, j0 + n - 1): place('3307', GOLD, i0, j, n, 1, yb + 6)
    corbels(i0, j0, n, yb + 12)
    parapet(i0, j0, n, yb + 15)

def blue_tower(i0, j0, yb):
    """the tall tower: on a base of 1x8 arches (two each side, front and back) with 1x8s across their ends, a grey floor,
    merlons; on it a 6x6 shaft, an arch through it each side, three red windows high in its face between round bricks,
    corbels, the crown"""
    for j in (j0, j0 + 1, j0 + 6, j0 + 7): place('3308', GOLD, i0, j, 8, 1, yb)
    b = yb + 6
    brick(i0, j0, 1, 8, b); brick(i0 + 7, j0, 1, 8, b)
    plate(i0 + 1, j0 + 1, 4, 6, b, GREY); plate(i0 + 5, j0 + 1, 2, 6, b, GREY)
    brick(i0 + 1, j0, 6, 1, b); brick(i0 + 1, j0 + 7, 6, 1, b)
    for (i, j) in ((i0, j0), (i0 + 6, j0), (i0, j0 + 6), (i0 + 6, j0 + 6)): brick(i, j, 2, 2, b + 3)
    brick(i0 + 3, j0, 2, 1, b + 3); brick(i0 + 3, j0 + 7, 2, 1, b + 3)
    brick(i0, j0 + 3, 1, 2, b + 3); brick(i0 + 7, j0 + 3, 1, 2, b + 3)
    s0, t0, n = i0 + 1, j0 + 1, 6
    y = b + 1
    for k in range(8):
        yy = y + 3 * k
        for j in (t0, t0 + n - 1):   # (front and back faces: the windows in the front, high up)
            if j == t0 + n - 1 and 3 <= k <= 5:
                brick(s0, j, 1, 1, yy); place('3062a', GOLD, s0 + 1, j, 1, 1, yy)
                place('3087c', RED, s0 + 2, j, 1, 1, yy, 180); place('3087c', RED, s0 + 3, j, 1, 1, yy, 180)
                place('3062a', GOLD, s0 + 4, j, 1, 1, yy); brick(s0 + 5, j, 1, 1, yy)
            elif k % 2 == 0: brick(s0, j, 6, 1, yy)
            else: brick(s0, j, 2, 1, yy); brick(s0 + 2, j, 2, 1, yy); brick(s0 + 4, j, 2, 1, yy)
        for i in (s0, s0 + n - 1):   # (the sides: an arch through each, from the floor)
            if k >= 5: brick(i, t0 + 1, 1, 4, yy)
        if k == 3:
            for i in (s0, s0 + n - 1): place('3307', GOLD, i, t0, 1, 6, yy)
    corbels(s0, t0, n, y + 24)
    parapet(s0, t0, n, y + 27)

step('10')
blue_tower(12, 0, 19)
small_tower(2, 16, 21)
small_tower(24, 16, 21)


# ---- 11: the gatehouse (page 16) set on the gate's blocks: two 1x8 arches over the gateway on 2x2 legs, yellow plates
# over, the winch on its left, merlons; the red drawbridge let down before the gate (a 6x8 plate, red rails along its
# sides, the two tabbed plates its chains are tied to at its foot), hinged at the pins; the flags on the towers
step('11')
for k in range(2):
    brick(10, 29, 2, 2, 18 + 3 * k); brick(20, 29, 2, 2, 18 + 3 * k)
for j in (29, 30): place('3308', GOLD, 12, j, 8, 1, 18)
plate(10, 27, 6, 4, 24); plate(16, 27, 6, 4, 24)
place('73037', GOLD, 10, 27, 4, 2, 25, 180)
place('3700', GOLD, 14, 30, 2, 1, 25); brick(16, 30, 2, 1, 25)
brick(20, 29, 2, 2, 25); brick(18, 27, 2, 1, 25); brick(14, 27, 2, 1, 25); brick(21, 27, 1, 2, 25)
# (the drawbridge, built level about its hinge, then let down till its foot is on the meadow)
db0 = len(parts)
plate(13, 30, 6, 8, 3, RED)
place('3176', RED, 13, 35, 2, 3, 4, 0); place('3176', RED, 17, 35, 2, 3, 4, 0)
place('3633', RED, 13, 31, 1, 4, 4, 90); place('3633', RED, 18, 31, 1, 4, 4, 90)
hinge_y, hinge_z = -3 * 8, (16 - 30) * 20
t = np.arctan2(3 * 8 + 4, 8 * 20)
c, sn = np.cos(t), np.sin(t)
Rx = np.array([[1, 0, 0], [0, c, -sn], [0, sn, c]])   # (about LDraw x: the far end, toward -z, comes down to +y)
for q in parts[db0:]:
    p0 = np.array(q['pos']) - [0, hinge_y, hinge_z]
    q['pos'] = [round(float(v), 3) for v in (Rx @ p0 + [0, hinge_y, hinge_z])]
    q['mat'] = [round(float(v), 4) for v in (Rx @ np.array(q['mat']).reshape(3, 3)).flatten()]
place('3596', WHITE, 30, 21, 1, 1, 42, 90)   # (on the yellow tower's corner)
place('3596', WHITE, 17, 30, 1, 1, 28, 90)   # (on the gatehouse)


def main():
    p = os.path.join(ROOT, 'web/assets/brick/items.json')
    d = json.load(open(p))
    d['_castle375'] = {'brick': 'The yellow castle of 1978 (set 375, after its instruction book), in chrome gold: its walls and '
                       'buttresses, its three towers, the gatehouse and red drawbridge, the great red doors, the grey wall-walk, on '
                       'its green base', 'upright': True, 'anchored': True,
                       'parts': [{k: v for k, v in q.items() if k != 'step'} for q in parts]}
    json.dump(d, open(p, 'w'), indent=1); open(p, 'a').write('\n')
    print(f'_castle375: {len(parts)} bricks')

if __name__ == '__main__':
    main()

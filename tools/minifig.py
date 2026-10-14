#!/usr/bin/env python3
"""Build a minifig as an LDraw .ldr, with accessories gripped properly in the hands.

  minifig.py SPEC.json OUT.ldr

SPEC example:
  {"torso": "973p40", "torsoColor": 4, "armColor": 4, "handColor": 14,
   "head": "3626bp05", "headColor": 14, "hat": "3844", "hatColor": 71,
   "hips": "3815", "hipColor": 0, "legColor": 0,
   "neck": {"part": "50231c01", "color": 1},
   "right": {"part": "3847", "color": 72, "aim": [0, -1, -0.6], "face": [1, 0, 0]},
   "left":  {"part": "3846p4c", "color": 15, "aim": [0, -1, 0], "face": [0.3, 0, -1]}}

"hair": {"part": "3759", "color": 226} adds hair (and "hat" can still go on top).
"plume": {"part": "87694", "color": 4} plugs a feather into the helmet's top.

"neck" can be one part or a list (e.g. a cape and an armour plate).

Held and neck items can carry "decal": {"image": "../decals/x.png"} (path
relative to the recipe; optional "center", "size" in LDU and "side":
"front"/"back") to print a picture on them; DECAL_SPOTS has the defaults.

A held item's "aim" is the world direction its handle should point out of the
top of the fist (the arm and wrist are posed to match); "face" is the way the
item should turn about the handle. Or give "swing"/"roll" in degrees directly.

LDraw axes: -Y is up, -Z is the minifig's front.
"""
import json, os, sys
import numpy as np

# Arms and hands, exactly as LDraw's assembled torso 973c01 places them.
ARM_R = ((-15.552, 9, 0), (0.985, -0.17, 0, 0.17, 0.985, 0, 0, 0, 1))
ARM_L = ((15.552, 9, 0), (0.985, 0.17, 0, -0.17, 0.985, 0, 0, 0, 1))
HAND_R = ((-23.6904, 26.774, -9.8982), (0.985, -0.1202, 0.1202, 0.17, 0.6964, -0.6964, 0, 0.707, 0.707))
HAND_L = ((23.6904, 26.774, -9.8982), (0.985, 0.1202, -0.1202, -0.17, 0.6964, -0.6964, 0, 0.707, 0.707))

# The hand's grip hole (from 3820.dat): centre and axis in the hand's own frame.
# The axis points out of the top of the fist (toward the thumb side).
GRIP_CENTER = np.array([0.0, -0.82, -9.9])
GRIP_AXIS = np.array([0.0, -10.65, -2.75]) / np.linalg.norm([0.0, -10.65, -2.75])

# Where each held item's handle is, in the item's own frame: centre of the
# gripped length, the direction that should leave the top of the fist, and the
# side that should face out ("face") when the item turns about its handle.
HELD = {
    '3847': {'center': (0, 12, 0), 'up': (0, -1, 0), 'face': (1, 0, 0)},   # shortsword: blade out of the top of the fist
    '3846': {'center': (0, 9, 0), 'up': (0, -1, 0), 'face': (0, 0, -1)},   # triangular shield: front is -Z
    '3876': {'center': (0, 9, 0), 'up': (0, -1, 0), 'face': (0, 0, -1)},   # round shield: same handle as 3846
    '2530': {'center': (0, 0, 0), 'up': (0, -1, 0)},                        # cutlass: blade out of the top of the fist
    '3841': {'center': (0, 28, 0), 'up': (0, -1, 0)},                       # pick-axe: held low on the haft, head up
    '61975': {'center': (0, 8, 0), 'up': (0, -1, 0), 'face': (0, 0, -1)},   # coiled whip: by its handle, the coil flat to the front
    '30152a': {'center': (0, 2, 0), 'up': (0, -1, 0), 'face': (0, 0, -1)},  # magnifying glass: lens up, facing out
    '3959': {'center': (0, 0, 12), 'up': (0, 0, -1)},                       # torch: flame up
}

# Where a custom picture ("decal") goes on a part, in the part's own frame:
# its centre, its size, and whether it is seen from the part's front (-Z) or back (+Z).
DECAL_SPOTS = {
    '3846': {'center': (0, 3, -10), 'size': (26, 26), 'side': 'front'},    # triangular shield
    '3876': {'center': (0, 0, -14), 'size': (36, 36), 'side': 'front'},    # round shield (rodela)
    '2587': {'center': (0, 12, -22), 'size': (18, 18), 'side': 'front'},   # classic armour plate: the chest
    '50231': {'center': (0, 28, 36), 'size': (28, 28), 'side': 'back'},    # cloth cape: between the shoulder blades
}


# Plume sockets on top of helmets, in the helmet's own frame.
PLUME_SOCKETS = {
    '89520': (0, -15, 0),   # Kingdoms closed helm with eye slit
    '4503': (0, -8, 0),     # helm with fixed face grille: hollow stud on top
    '30048': (-7, -12, 7),  # morion: plume hole behind the crest, on its left
}


def held_info(part):
    for prefix, info in HELD.items():
        if part.startswith(prefix):
            return info
    return {'center': (0, 0, 0), 'up': (0, -1, 0)}


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def rot_axis(axis, ang):
    """Rotation matrix of ang radians about a unit axis (Rodrigues)."""
    x, y, z = unit(axis)
    K = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K


def frame(up):
    """Rotation whose Y column is -up (so the item's 'up' maps onto the grip axis)."""
    y = -unit(up)
    x = np.array([1.0, 0, 0]) if abs(y[0]) < 0.9 else np.array([0, 0, 1.0])
    x -= y * (x @ y); x /= np.linalg.norm(x)
    return np.column_stack([x, y, np.cross(x, y)])


def pose_arm(arm, hand, swing, roll):
    """Swing the arm about its shoulder (the arm's own X axis) and roll the
    hand about its wrist (the hand's own Z axis). Angles in degrees."""
    ap, am = np.array(arm[0], float), np.array(arm[1], float).reshape(3, 3)
    hp, hm = np.array(hand[0], float), np.array(hand[1], float).reshape(3, 3)
    S = rot_axis(am[:, 0], np.radians(swing))
    return (ap, S @ am), (ap + S @ (hp - ap), S @ hm @ rot_axis((0, 0, 1), np.radians(roll)))


def solve_pose(arm, hand, aim):
    """Find shoulder swing and wrist roll that point the grip axis along aim."""
    aim = unit(aim)
    best = None
    for swing in range(-90, 31, 3):
        for roll in range(-180, 180, 3):
            _, (hp, hm) = pose_arm(arm, hand, swing, roll)
            err = 1 - (hm @ GRIP_AXIS) @ aim + 1e-4 * abs(swing)
            if best is None or err < best[0]:
                best = (err, swing, roll)
    return best[1], best[2]


def grip(hand, part, face=None):
    """World placement (pos, 3x3) for a part held in the given hand. The item
    can turn freely about the grip axis; face picks which way it turns."""
    hp, hm = np.array(hand[0], float), np.array(hand[1], float).reshape(3, 3)
    info = held_info(part)
    rot = frame(GRIP_AXIS) @ frame(info['up']).T   # item frame -> hand frame, item 'up' onto the grip axis
    if face is not None and 'face' in info:
        best = None
        for deg in range(0, 360, 2):
            r = rot_axis(GRIP_AXIS, np.radians(deg)) @ rot
            score = (hm @ r @ unit(info['face'])) @ unit(face)
            if best is None or score > best[0]:
                best = (score, r)
        rot = best[1]
    pos_h = GRIP_CENTER - rot @ np.array(info['center'], float)
    return hp + hm @ pos_h, hm @ rot


def decal_line(item, pos, mat, base_dir):
    """An LDraw !TEXMAP line that prints item['decal'] (an image) on the item.
    The image's top-left, top-right and bottom-left corners map to p1, p2, p3,
    as seen by someone looking at that side of the part."""
    d = item['decal']
    spot = next((v for k, v in DECAL_SPOTS.items() if item['part'].startswith(k)), {})
    cx, cy, cz = d.get('center', spot.get('center', (0, 0, 0)))
    w, h = d.get('size', spot.get('size', (20, 20)))
    if d.get('side', spot.get('side', 'front')) == 'back':
        w = -w   # seen from behind, the viewer's right is the part's -X
    local = np.array([(cx - w / 2, cy - h / 2, cz), (cx + w / 2, cy - h / 2, cz), (cx - w / 2, cy + h / 2, cz)])
    pts = (np.asarray(mat) @ local.T).T + pos
    img = os.path.abspath(os.path.join(base_dir, d['image']))
    return '0 !TEXMAP NEXT PLANAR ' + ' '.join(f'{v:.4f}' for v in pts.flatten()) + ' ' + img


def line(color, pos, mat, part):
    p = ' '.join(f'{v:.4f}'.rstrip('0').rstrip('.') for v in pos)
    m = ' '.join(f'{v:.4f}'.rstrip('0').rstrip('.') for v in np.asarray(mat).flatten())
    return f'1 {color} {p} {m} {part}.dat'


def build(spec, base_dir='.'):
    """base_dir: where relative decal image paths are resolved from."""
    I = np.eye(3)
    out = [f"0 {spec.get('name', 'Minifig')}"]
    out.append(line(spec.get('torsoColor', 15), (0, 0, 0), I, spec.get('torso', '973')))
    sides = {}
    for side, arm, hand, part in (('right', ARM_R, HAND_R, spec.get('armR', '3818')),
                                  ('left', ARM_L, HAND_L, spec.get('armL', '3819'))):
        item = spec.get(side) or {}
        if 'aim' in item:
            swing, roll = solve_pose(arm, hand, item['aim'])
        else:
            swing, roll = item.get('swing', 0), item.get('roll', 0)
        a, h = pose_arm(arm, hand, swing, roll)
        sides[side] = h
        out.append(line(spec.get('armColor', 15), a[0], a[1], part))
        out.append(line(spec.get('handColor', 14), h[0], h[1], '3820'))
    neck = spec.get('neck') or []   # capes, armour and other neck-bracket items sit between head and torso
    for item in neck if isinstance(neck, list) else [neck]:
        if item.get('decal'):
            out.append(decal_line(item, np.zeros(3), I, base_dir))
        out.append(line(item.get('color', 16), (0, 0, 0), I, item['part']))
    out.append(line(spec.get('headColor', 14), (0, -24, 0), I, spec.get('head', '3626bp01')))
    if spec.get('hair'):   # hair under a helmet (or alone): {"part", "color"}
        out.append(line(spec['hair'].get('color', 70), (0, -24, 0), I, spec['hair']['part']))
    if spec.get('hat'):
        out.append(line(spec.get('hatColor', 0), (0, -24, 0), I, spec['hat']))
        plume = spec.get('plume')
        if plume:
            socket = next((v for k, v in PLUME_SOCKETS.items() if spec['hat'].startswith(k)), (0, -15, 0))
            out.append(line(plume.get('color', 4), np.add((0, -24, 0), socket), I, plume.get('part', '87694')))
    out.append(line(spec.get('hipColor', 1), (0, 32, 0), I, spec.get('hips', '3815')))
    out.append(line(spec.get('legColor', spec.get('hipColor', 1)), (0, 44, 0), I, spec.get('legR', '3816')))
    out.append(line(spec.get('legColor', spec.get('hipColor', 1)), (0, 44, 0), I, spec.get('legL', '3817')))
    for side, hand in sides.items():
        item = spec.get(side)
        if item:
            pos, mat = grip(hand, item['part'], item.get('face'))
            if item.get('decal'):
                out.append(decal_line(item, pos, mat, base_dir))
            out.append(line(item.get('color', 16), pos, mat, item['part']))
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    spec = json.load(open(sys.argv[1]))
    open(sys.argv[2], 'w').write(build(spec, os.path.dirname(os.path.abspath(sys.argv[1]))))

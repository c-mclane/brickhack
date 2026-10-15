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

"torsoDecal": {"image": ...} prints a picture on the chest; "hatDecal" one on the hat.
"dress": {"part": "3678b", "color": 1} stands her on a sloped brick instead of legs.
"shortLegs": {"part": "16709", "color": 28} gives short legs (hips and legs in one piece).
"extras": [{"part", "color", "pos": [x, y, z]}] adds any part (a tiara in the hair...),
turned by "rot": [{"axis": [x, y, z], "deg": d}, ...] (in order) if given.
"headRecolor": {"0": "4"} swaps colours in the face's print (black eyes made red...);
"base": "barbarian-m" starts from another recipe; "ghost": "right" or "left"
turns that side of the figure (as you face it) to doppelganger mist;
"quantum": true makes every part plain and flashing (a quantum mechanic);
"aura": true wraps the figure in a glowing white corona (an angel);
"marble": {"color": 15, "detail": 71, "keep": ["11264p01"]} makes a statue: every
part (but those kept) the one colour, its prints in the detail colour.
"torsoRecolor" likewise for the torso's print (printed skin made pale);
a hair's "recolor" does the same for the hair (an elf-hair's printed ears in the skin colour).
"hair": {"part": "3759", "color": 226} adds hair (and "hat" can still go on top).
"plume": {"part": "87694", "color": 4} plugs a feather into the helmet's top.

"neck" can be one part or a list (e.g. a cape and an armour plate); a neck
item's "turn" (degrees about the vertical) swings it round, e.g. a quiver onto the back.

"skeleton": true builds a LEGO skeleton: "torso" should be 6260 (its pelvis
built in), the arms are bones (6265, claws and all; no hands) hanging from
its shoulder balls, the legs bones (6266) clipped to its hip axle.

Held and neck items can carry "decal": {"image": "../decals/x.png"} (path
relative to the recipe; optional "center", "size" in LDU and "side":
"front"/"back") to print a picture on them; DECAL_SPOTS has the defaults.

A held item's "aim" is the world direction its handle should point out of the
top of the fist (the arm and wrist are posed to match); "face" is the way the
item should turn about the handle. Or give "swing"/"roll" in degrees directly.

LDraw axes: -Y is up, -Z is the minifig's front.
"""
import hashlib, json, os, sys
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
    '18395': {'center': (0, -5, 0), 'up': (0, -1, 0)},                      # flame: by its bar, burning upward
    '30385': {'center': (0, 8, 0), 'up': (0, -1, 0)},                       # crystal: standing on top of the fist
    '49492': {'center': (0, -40, 0), 'up': (0, -1, 0)},                     # shepherd's crook / crozier: the hook up
    '4499': {'center': (0, -1, 0), 'up': (0, -1, 0)},                       # bow with arrow: upright, the arrow ahead, the string to the archer
    '2570': {'center': (0, 2, 0), 'up': (0, -1, 0)},                       # crossbow: by its pistol grip, the bolt (its -Z) ahead
    '4497': {'center': (0, 30, 0), 'up': (0, -1, 0)},                       # spear: held below the middle, point up
    '30173a': {'center': (0, 6, 0), 'up': (0, -1, 0)},                      # katana: blade up out of the fist
    '95049': {'center': (0, 14, 0), 'up': (0, -1, 0)},                      # staff with a ball: the ball up
    '95050': {'center': (0, 12, 0), 'up': (0, -1, 0)},                      # staff with a crescent: the crescent up
    '37341d': {'center': (0, -6, 0), 'up': (0, -1, 0)},                     # scythe: by the foot of its haft, blade up
    '3835': {'center': (0, 22, 0), 'up': (0, -1, 0)},                       # hand-axe: low on the haft, head up
    '37341b': {'center': (0, 4, 0), 'up': (0, -1, 0)},                      # knife: blade up out of the fist
    '13790': {'center': (0, 8, 0), 'up': (0, -1, 0)},                       # club: by its handle, the thick end up
    '4006': {'center': (0, 6, 0), 'up': (0, -1, 0)},                        # spanner: by the middle, the jaws up
    '3849': {'center': (0, 0, 14), 'up': (0, 0, -1)},                       # lance: behind its guard, the point forward (it lies along -Z)
    '13564': {'center': (4, 0, 0), 'up': (-1, 0, 0)},                       # cow horn (a worm tooth): by its root, the point out (along -X)
    '87994': {'center': (0, 40, 0), 'up': (0, -1, 0)},                      # bar 3L (a stake's shaft): low down, its top up
    '23860': {'center': (0, -4, 0), 'up': (0, -1, 0)},                      # faceted blade: by its bar, the blade up
    '27257': {'center': (0, -2, 0), 'up': (0, -1, 0)},                      # spear tip (a leaf-bladed dagger): by its bar, point up
    '36752a': {'center': (0, -2, 0), 'up': (0, -1, 0)},                     # wand (a stiletto): by its end, the needle up
    '55298': {'center': (0, 6, 0), 'up': (0, -1, 0)},                       # screwdriver (a scalpel): by the handle, the shaft up
    '44658': {'center': (0, 2, 0), 'up': (0, -1, 0)},                       # knife: by the handle, blade up
    '88288': {'center': (0, 6, 0), 'up': (0, -1, 0)},                       # curved dagger (an athame): by its grip, blade up
    '98338': {'center': (0, 2, 0), 'up': (0, -1, 0)},                       # kunai: by its ribbed grip, blade up
    '95054': {'center': (0, 4, 0), 'up': (0, -1, 0)},                       # Ninjago knife: by its grip
    '5685': {'center': (0, 11, 0), 'up': (0, -1, 0), 'face': (1, 0, 0)},     # Dune crysknife (ldraw-extra): by its ribbed grip, blade up, its flat out
    '95053': {'center': (0, 5, 0), 'up': (0, -1, 0)},                       # small sword, angular guard (a stiletto)
    '64567': {'center': (0, 18, 0), 'up': (0, -1, 0)},                      # lightsaber hilt (a great dagger's): by the hilt, the top up
    '55295': {'center': (0, 4, 0), 'up': (0, -1, 0)},                       # hammer: by the handle, head up
    '30374': {'center': (0, 58, 0), 'up': (0, -1, 0)},
    '93789': {'center': (0, 30, 0), 'up': (0, -1, 0)},                      # spear with a flat end: below the middle, point up
    '90391': {'center': (0, 30, 0), 'up': (0, -1, 0)},                      # elaborate pike: below the middle, head up
    '92290': {'center': (0, -20, 0), 'up': (0, -1, 0)},                     # trident: low on the shaft, prongs up
    '93231': {'center': (0, 0, 0), 'up': (0, -1, 0)},                      # long bow with arrow: likewise
    '95051': {'center': (0, 0, 0), 'up': (0, -1, 0)},                      # small bow with arrow: likewise
    '18041': {'center': (0, -12, 0), 'up': (0, -1, 0)},                     # harpoon (an arrow): by the shaft, point up
    '57467': {'center': (0, -12, 0), 'up': (0, -1, 0)},                     # harpoon (a crossbow bolt): likewise
    '24482': {'center': (0, 0, 0), 'up': (0, -1, 0)},                       # finned spike (a dart): point up
    '2488': {'center': (0, 14, 0), 'up': (0, -1, 0)},                       # whip: by its handle
    '88704': {'center': (0, -5, 0), 'up': (0, -1, 0)},                      # flexible whip (a rubber hose): by its end
    '55707': {'center': (0, 12, 0), 'up': (0, -1, 0)},   # pistol, drum-magazine gun: by the grip, the barrel forward
    '44709': {'center': (0, 0, 0), 'up': (0, -1, 0)},    # bulky blaster: by the grip, the barrel forward
    '30141': {'center': (0, 0, 0), 'up': (0, -1, 0)},    # rifle
    '57899': {'center': (0, 8, 0), 'up': (0, -1, 0)},    # long blaster
    '92738': {'center': (0, 0, 0), 'up': (0, -1, 0)},    # blaster with a telescopic sight
    '95199': {'center': (0, 0, 0), 'up': (0, -1, 0)},    # two-barrel pistol (a sawn-off shotgun)
    '2561': {'center': (0, 30, 0), 'up': (0, 0, 1)},                        # musket: by the wrist of the stock, the barrel forward
    '15391': {'center': (0, -8, 0), 'up': (0, -1, 0)},   # shooting blaster
    '18588': {'center': (0, 0, 0), 'up': (0, -1, 0)},                       # launcher barrel
    '20546': {'center': (0, 4, 0), 'up': (0, -1, 0)},                       # slingshot: by its handle, the fork up
    '17010': {'center': (0, 6, 0), 'up': (0, -1, 0)},    # blaster with two barrels: by the grip, the barrels forward
    '18588': {'center': (0, 66, 44), 'up': (0, -1, 0)},                     # launcher barrel: by the pistol grip under its back (a bar down from a clip on a pin's bar), the barrel ahead
    '6123': {'center': (0, 30, 0), 'up': (0, -1, 0)},                       # halberd: below the middle, head up
    '43899': {'center': (0, 150, 0), 'up': (0, -1, 0)},                     # spear with four side blades: low on the shaft, blades up
    '55237': {'center': (0, -15, 0), 'up': (0, -1, 0)},                     # bars with weapon heads (a polearm each): low down, head up
    '98137': {'center': (0, -20, 0), 'up': (0, -1, 0)},                     # long curved blade on a bar: by the bar, blade up
    '4095': {'center': (0, -20, 0), 'up': (0, -1, 0)},                      # bar 6.6L with stop (a polearm's shaft): low down, its top up                      # bar 4L (a battle-axe's haft): low down, its top up
    '3848': {'center': (0, 45, 0), 'up': (0, -1, 0)},                       # battleaxe: low on the long haft, head up
    '39802': {'center': (0, 22, 0), 'up': (0, -1, 0)},                      # axe with a pick end (a mattock): low on the haft, head up
    '88001': {'center': (0, 2, 0), 'up': (0, -1, 0)},                       # spiked club: by the handle, the spikes up
    '93220': {'center': (0, 6, 0), 'up': (0, -1, 0)},                       # baseball bat: by the handle, the barrel up
    '59232': {'center': (0, -8, 0), 'up': (0, -1, 0)},                      # morning star (a flail): by the handle, the chain and ball up
    '67100': {'center': (0, 6, 0), 'up': (0, -1, 0)},                       # nunchaku (a flail): by one stick, the other up
    '75904': {'center': (0, 14, 0), 'up': (0, -1, 0)},                      # sledgehammer: by the handle, head up
    '63965': {'center': (0, -42, 0), 'up': (0, -1, 0)},                     # bar 6L with stop ring (a quarterstaff): held in the middle
}

# Where a custom picture ("decal") goes on a part, in the part's own frame:
# its centre, its size, and whether it is seen from the part's front (-Z) or back (+Z).
DECAL_SPOTS = {
    '3846': {'center': (0, 3, -10), 'size': (26, 26), 'side': 'front'},    # triangular shield
    '3876': {'center': (0, 0, -14), 'size': (36, 36), 'side': 'front'},    # round shield (rodela)
    '2587': {'center': (0, 12, -22), 'size': (18, 18), 'side': 'front'},   # classic armour plate: the chest
    '50231': {'center': (0, 28, 36), 'size': (28, 28), 'side': 'back'},    # cloth cape: between the shoulder blades
    '973': {'center': (0, 15, -10), 'size': (17, 17), 'side': 'front'},     # torso: the chest
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


def grip_frame(hand, face=(1, 0, 0)):
    """Where a held item goes, for an item built in the standard held frame
    (tools/build_items.py: its grip's centre at the origin, its 'up' -Y): the
    placement (pos, 3x3) in the figure's frame, the item turned about its
    grip so its +X (a blade's flat) faces `face`."""
    hp, hm = np.array(hand[0], float), np.array(hand[1], float).reshape(3, 3)
    rot = frame(GRIP_AXIS) @ frame((0, -1, 0)).T
    best = None
    for deg in range(0, 360, 2):
        r = rot_axis(GRIP_AXIS, np.radians(deg)) @ rot
        score = (hm @ r @ np.array([1.0, 0, 0])) @ unit(face)
        if best is None or score > best[0]:
            best = (score, r)
    rot = best[1]
    return hp + hm @ GRIP_CENTER, hm @ rot


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


# ---- recoloured parts: a copy of a part (and of the sub-parts its print lives in)
# with some colours swapped, e.g. a face's black eyes made red, an elf-hair's
# printed ears in the wearer's skin colour.  Written once, referenced by path.
LDRAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'vendor', 'ldraw', 'ldraw')
EXTRA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ldraw-extra')   # our own parts (ldraw2glb.EXTRA)
DERIVED = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'lego', 'cache', 'derived')


def _ldraw_file(name):
    name = name.replace('\\', '/')
    for root, d in ((LDRAW, 'parts'), (LDRAW, 'p'), (EXTRA, 'parts')):
        f = os.path.join(root, d, name if name.endswith('.dat') else name + '.dat')
        if os.path.isfile(f):
            return f, d == 'p'
    return None, False


def recolored(part, cmap):
    """Path (without .dat) of `part` with colours swapped by cmap {'0': '4', ...};
    '*' stands for every other colour the part has of its own (a print)."""
    if not cmap:
        return part
    cmap = {str(k): str(v) for k, v in cmap.items()}
    src, primitive = _ldraw_file(part)
    if not src or primitive:
        return part
    key = hashlib.sha1((part + json.dumps(cmap, sort_keys=True)).encode()).hexdigest()[:10]
    out = os.path.join(DERIVED, os.path.basename(part.replace('\\', '/')).replace('.dat', '') + '_' + key)
    if not os.path.exists(out + '.dat'):
        os.makedirs(DERIVED, exist_ok=True)
        lines = []
        for l in open(src, encoding='utf-8', errors='replace'):
            t = l.split()
            if len(t) > 2 and t[0] in '1234':
                if t[1] in cmap:
                    t[1] = cmap[t[1]]
                elif '*' in cmap and t[1] not in ('16', '24'):
                    t[1] = cmap['*']
                if t[0] == '1' and len(t) >= 15:
                    sub = ' '.join(t[14:])
                    new = recolored(sub, cmap)
                    if new != sub:
                        t = t[:14] + [new + '.dat']
                l = ' '.join(t) + '\n'
            lines.append(l)
        open(out + '.dat', 'w').write(''.join(lines))
    return out


def line(color, pos, mat, part):
    p = ' '.join(f'{v:.4f}'.rstrip('0').rstrip('.') for v in pos)
    m = ' '.join(f'{v:.4f}'.rstrip('0').rstrip('.') for v in np.asarray(mat).flatten())
    return f'1 {color} {p} {m} {part}.dat'


# A skeleton (torso 6260): its shoulder balls and hip axle, and how far its
# bone arms (6265: modelled reaching forward, -Z, the claw at (0, 0, -30))
# hang down from straight out in front.
SKEL_SHOULDER = (21.2, 6.8, 0)
SKEL_HIP = 44.8
SKEL_HANG = 70
SKEL_CLAW = (0, 0, -30)   # the middle of a bone arm's claw (6265.dat's !HELP)


def skeleton_arm(out, G, spec, side):
    """Write a skeleton's arm (its own joint, armR/armL) and return its rig."""
    x = SKEL_SHOULDER[0] * (-1 if side == 'right' else 1)
    pivot = np.array([x, SKEL_SHOULDER[1], SKEL_SHOULDER[2]])
    m = rot_axis((1, 0, 0), np.radians(SKEL_HANG))
    G('arm' + side[0].upper())
    out.append(line(spec.get('armColor', 15), pivot, m, spec.get('arm' + side[0].upper(), '6265')))
    # a held item: in the claw, its blade (held -Y) along the bone's -Y, out
    # forward over the claw; its flat (+X) to the side
    grip = {'pos': [float(v) for v in pivot + m @ np.array(SKEL_CLAW)], 'mat': [float(v) for v in m.flatten()]}
    return {'pivot': [float(v) for v in pivot], 'axis': [1.0, 0.0, 0.0], 'swing': 0.0, 'grip': grip}


def build(spec, base_dir='.'):
    """base_dir: where relative decal image paths are resolved from."""
    if spec.get('base'):   # another recipe (in base_dir), with this one's changes on top
        base = json.load(open(os.path.join(base_dir, spec['base'] + '.json')))
        spec = {**base, **{k: v for k, v in spec.items() if k != 'base'}}
    I = np.eye(3)
    out = [f"0 {spec.get('name', 'Minifig')}"]
    if spec.get('ghost'):   # a doppelganger: one side of the figure is mist (ldraw2glb.ghosted)
        out.append(f"0 !LEGOHACK GHOST {1 if spec['ghost'] == 'right' else -1}")
    if spec.get('aura'):   # an angel: the renderers wrap the figure in a white glow
        out.append("0 !LEGOHACK AURA")
    if spec.get('quantum'):   # a quantum mechanic: every part a plain colour, strobing (ldraw2glb.figure_geom)
        out.append("0 !LEGOHACK QUANTUM")
    G = lambda g: out.append(f'0 !LEGOHACK GROUP {g}')   # what follows moves with this joint (animation)
    G('body')
    if spec.get('torsoDecal'):   # a picture on the chest
        out.append(decal_line({'part': spec.get('torso', '973'), 'decal': spec['torsoDecal']}, np.zeros(3), I, base_dir))
    out.append(line(spec.get('torsoColor', 15), (0, 0, 0), I, recolored(spec.get('torso', '973'), spec.get('torsoRecolor'))))
    sides, rig = {}, {}
    skel = spec.get('skeleton')
    for side, arm, hand, part in (('right', ARM_R, HAND_R, spec.get('armR', '3818')),
                                  ('left', ARM_L, HAND_L, spec.get('armL', '3819'))):
        if skel:   # a skeleton's arm: one bone, claw and all, on a ball at the shoulder (skeleton_arm)
            rig['arm' + side[0].upper()] = skeleton_arm(out, G, spec, side)
            continue
        item = spec.get(side) or {}
        if 'aim' in item:
            swing, roll = solve_pose(arm, hand, item['aim'])
        else:
            swing, roll = item.get('swing', 0), item.get('roll', 0)
        a, h = pose_arm(arm, hand, swing, roll)
        sides[side] = h
        gp, gm = grip_frame(h)
        # the shoulder: the arm swings about its own X axis through its origin (pose_arm)
        rig['arm' + side[0].upper()] = {'pivot': list(map(float, arm[0])), 'axis': list(map(float, np.array(arm[1], float).reshape(3, 3)[:, 0])), 'swing': float(swing),
                                        'grip': {'pos': [float(v) for v in gp], 'mat': [float(v) for v in gm.flatten()]}}   # (where a held item goes: grip_frame)
        G('arm' + side[0].upper())
        out.append(line(spec.get('armColor', 15), a[0], a[1], part))
        # the hand: a joint of its own (it turns at the wrist, about its own Z axis: pose_arm's roll)
        rig['hand' + side[0].upper()] = {'pivot': [float(v) for v in h[0]], 'axis': [float(v) for v in np.array(h[1]).reshape(3, 3)[:, 2]]}
        G('hand' + side[0].upper())
        out.append(line(spec.get('handColor', 14), h[0], h[1], '3820'))
    G('body')
    neck = spec.get('neck') or []   # capes, armour and other neck-bracket items sit between head and torso
    for item in neck if isinstance(neck, list) else [neck]:
        R = rot_axis((0, 1, 0), np.radians(item.get('turn', 0)))   # e.g. a quiver turned round onto the back
        if item.get('decal'):
            out.append(decal_line(item, np.zeros(3), R, base_dir))
        out.append(line(item.get('color', 16), (0, 0, 0), R, item['part']))
    G('head')
    out.append(line(spec.get('headColor', 14), (0, -24, 0), I, recolored(spec.get('head', '3626bp01'), spec.get('headRecolor'))))
    if spec.get('hair'):   # hair under a helmet (or alone): {"part", "color"}
        out.append(line(spec['hair'].get('color', 70), (0, -24, 0), I, recolored(spec['hair']['part'], spec['hair'].get('recolor'))))
    if spec.get('hat'):
        if spec.get('hatDecal'):   # a picture on the hat's front ("center"/"size" in the hat's frame)
            out.append(decal_line({'part': spec['hat'], 'decal': spec['hatDecal']}, np.array([0.0, -24, 0]), I, base_dir))
        out.append(line(spec.get('hatColor', 0), (0, -24, 0), I, spec['hat']))
        plume = spec.get('plume')
        if plume:
            socket = next((v for k, v in PLUME_SOCKETS.items() if spec['hat'].startswith(k)), (0, -15, 0))
            out.append(line(plume.get('color', 4), np.add((0, -24, 0), socket), I, plume.get('part', '87694')))
    G('body')
    if spec.get('dress'):
        # a long dress, the classic LEGO way: no hips or legs, the torso straight on
        # a sloped brick's top studs, turned round so its slope is at the back
        R180 = np.diag([-1.0, 1, -1])
        out.append(line(spec['dress'].get('color', 16), (0, 32, 0), R180, spec['dress'].get('part', '3678b')))
    elif skel:
        # a skeleton: its torso has its pelvis built in; the bone legs clip onto its axle
        for g, x in (('legR', -10), ('legL', 10)):
            G(g)
            out.append(line(spec.get('legColor', 15), (x, SKEL_HIP, 0), I, spec.get(g, '6266')))
        rig['legs'] = {'pivot': [0.0, SKEL_HIP, 0.0], 'axis': [1.0, 0.0, 0.0]}
    elif spec.get('shortLegs'):
        # short legs (a dwarf, a child): hips and legs in one piece
        out.append(line(spec['shortLegs'].get('color', 16), (0, 32, 0), I, spec['shortLegs'].get('part', '16709')))
    else:
        out.append(line(spec.get('hipColor', 1), (0, 32, 0), I, spec.get('hips', '3815')))
        G('legR')
        out.append(line(spec.get('legColor', spec.get('hipColor', 1)), (0, 44, 0), I, spec.get('legR', '3816')))
        G('legL')
        out.append(line(spec.get('legColor', spec.get('hipColor', 1)), (0, 44, 0), I, spec.get('legL', '3817')))
        rig['legs'] = {'pivot': [0.0, 44.0, 0.0], 'axis': [1.0, 0.0, 0.0]}   # the hip pin
    for x in spec.get('extras', []):   # any other part, at a place in the figure's frame (e.g. a tiara in the hair)
        G('head' if x['pos'][1] < -20 else 'body')   # (a tiara turns with the head; wings and tails stay on the body)
        mat = I
        for r in x.get('rot', []):   # turns, in order: {"axis": [x, y, z], "deg": d}
            mat = rot_axis(r['axis'], np.radians(r['deg'])) @ mat
        out.append(line(x.get('color', 16), x['pos'], mat, x['part']))
    for side, hand in sides.items():
        item = spec.get(side)
        if item:
            pos, mat = grip(hand, item['part'], item.get('face'))
            G('item' + side[0].upper())   # moves with its arm; a separate node so the game can swap what's held
            rig['arm' + side[0].upper()]['holds'] = True
            if item.get('decal'):
                out.append(decal_line(item, pos, mat, base_dir))
            out.append(line(item.get('color', 16), pos, mat, item['part']))
    dy = 0
    if spec.get('dress'):
        # the dress brick (48 LDU) is 8 taller than hips and legs (40): lift everything so she still stands on the floor
        dy = -(48 - 40)
    elif skel:
        # a skeleton: its torso has its pelvis built in; the bone legs clip onto its axle
        for g, x in (('legR', -10), ('legL', 10)):
            G(g)
            out.append(line(spec.get('legColor', 15), (x, SKEL_HIP, 0), I, spec.get(g, '6266')))
        rig['legs'] = {'pivot': [0.0, SKEL_HIP, 0.0], 'axis': [1.0, 0.0, 0.0]}
    elif spec.get('shortLegs'):
        # short legs end 16 LDU higher than legs: lower everything so the feet are on the floor
        dy = 16
    out = [shift(l, dy) for l in out]
    # the joints, for the animation: shoulders, hips, neck (LDraw units, the figure's frame)
    rig['head'] = {'pivot': [0.0, 0.0, 0.0], 'axis': [0.0, 1.0, 0.0]}   # turns about the neck
    rig['waist'] = {'pivot': [0.0, 32.0, 0.0]}   # (breathing: the body swells from the waist)
    for j in rig.values():
        j['pivot'][1] += dy
        if 'grip' in j:
            j['grip']['pos'][1] += dy
    out.insert(1, '0 !LEGOHACK RIG ' + json.dumps(rig, separators=(',', ':')))
    if spec.get('marble'):   # a statue: every part marble, its prints carved in one faint colour
        m = spec['marble']
        keep = set(m.get('keep', []))
        for i, l in enumerate(out):
            t = l.split()
            if t[0] != '1' or len(t) < 15:
                continue
            part = ' '.join(t[14:])[:-4]
            if part in keep:
                continue
            out[i] = ' '.join(t[:1] + [str(m.get('color', 15))] + t[2:14] + [recolored(part, {'*': str(m.get('detail', 71))}) + '.dat'])
    return '\n'.join(out) + '\n'


def shift(l, dy):
    """An LDraw line moved dy in Y (part lines and !TEXMAP lines; others as they are)."""
    t = l.split(' ')
    if t[0] == '1':
        t[3] = f'{float(t[3]) + dy:.4f}'
    elif l.startswith('0 !TEXMAP NEXT PLANAR'):
        for i in (6, 9, 12):   # the y of p1, p2, p3
            t[i] = f'{float(t[i]) + dy:.4f}'
    return ' '.join(t)


if __name__ == '__main__':
    spec = json.load(open(sys.argv[1]))
    open(sys.argv[2], 'w').write(build(spec, os.path.dirname(os.path.abspath(sys.argv[1]))))

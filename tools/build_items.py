#!/usr/bin/env python3
"""Build the LEGO versions of NetHack's items (web/assets/lego/items.json).

  build_items.py

Each item's parts, as they'd be held (held_ldr): its grip at the origin, a
blade pointing up (LDraw: -Y), its flat toward +X, so the same model serves
for an item in a hand (a figure's rig has each hand's grip: minifig.grip_frame)
and, laid down by the game, on the floor (brickworld.js). Writes
  web/assets/lego/items/<name>.glb      (rebuilt only when it changed)
  web/assets/lego/items.built.json      {name: {url, lego}}
"""
import hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ldraw2glb, minifig
import numpy as np

LEGO = os.path.join(HERE, '..', 'web', 'assets', 'lego')
OUT = os.path.join(LEGO, 'items')


def held_ldr(item):
    """The item as held: its main (first) part's grip (minifig.HELD) centred
    on the origin, the end that leaves the top of a fist up (-Y), the flat of
    a blade (its 'face') toward +X; the other parts placed with it (each
    turned by its own "mat" and/or "rot", if given, as a figure's extras are)."""
    info = minifig.held_info(item['parts'][0]['part'])
    R = minifig.frame(info['up']).T   # the item's 'up' onto -Y
    if 'face' in info:   # ...and turned about Y to bring its face round to +X
        f = R @ minifig.unit(info['face'])
        a = np.arctan2(f[2], f[0])
        R = minifig.rot_axis((0, 1, 0), a) @ R
    c = np.array(info['center'], float)
    out = ''
    for p in item['parts']:
        M = np.array(p['mat'], float).reshape(3, 3) if 'mat' in p else np.eye(3)   # a whole turn, as LDraw writes one (rows)
        for r in p.get('rot', []):   # turns, in order: {"axis": [x, y, z], "deg": d}
            M = minifig.rot_axis(r['axis'], np.radians(r['deg'])) @ M
        out += minifig.line(p.get('color', 16), R @ (np.array(p.get('pos', [0, 0, 0]), float) - c), R @ M, p['part']) + '\n'
    return out


SLASHEM = os.path.join(HERE, '..', 'vendor', 'SlashEM')
ART_TILE = 90000   # the game sends an artifact as ART_TILE + its number (port/winweb.c web_obj_tile)


def artifacts():
    """SLASH'EM's artifacts: {number: (name, base item)}, from its artifact list
    (include/artilist.h) and the numbers makedefs gave them (include/onames.h).
    Names lose a leading "The " ("The Dagger of Creation": "Dagger of Creation")."""
    arts = {}
    try:
        names = open(os.path.join(SLASHEM, 'include', 'artilist.h'), encoding='latin-1').read()
        nums = open(os.path.join(SLASHEM, 'include', 'onames.h'), encoding='latin-1').read()
    except OSError:
        return arts
    num = {m.group(1): int(m.group(2)) for m in re.finditer(r'#define\s+ART_(\w+)\s+(\d+)', nums)}
    for name, base in re.findall(r'^A\("([^"]+)",\s*([A-Z_0-9]+),', names, re.M):
        short = name[4:] if name.startswith('The ') else name
        words = short.upper().split()
        n = next((num[k] for i in range(len(words))   # (makedefs shortens a few: "Platinum Yendorian
                  for k in [re.sub(r'[^A-Z0-9]', '_', ' '.join(words[i:]))] if k in num), None)   # Express Card")
        if n:
            arts[n] = (short, base.lower().replace('_', ' '))
    return arts


def main():
    os.makedirs(OUT, exist_ok=True)
    colors = ldraw2glb.load_colors(ldraw2glb.LDRAW)
    lib = ldraw2glb.Library(ldraw2glb.LDRAW)
    built = {}
    arts = artifacts()
    art_num = {name: n for n, (name, base) in arts.items()}
    for name, item in json.load(open(os.path.join(LEGO, 'items.json'))).items():
        ldr = held_ldr(item)
        # an angel's glow round it (mist.js addAura): true, or {color, scale, tip: {fraction}}
        # (the tip's end: up as held, glTF +Y)
        aura = item.get('aura')
        if isinstance(aura, dict) and 'tip' in aura:
            aura = dict(aura, tip=dict({'dir': [0, 1, 0]}, **aura['tip']))
        extras = dict({'aura': aura} if aura else {}, **({'lightning': True} if item.get('lightning') else {})) or None
        glow = item.get('glow')   # its tip glowing: {"fraction": of its length from the tip, "color": a translucent one}
        if glow:   # (held, its tip is up: -Y)
            ldr = f"0 !LEGOHACK GLOW 0 -1 0 {glow['fraction']} {glow['color']}\n" + ldr
        key = hashlib.sha1((ldr + ldraw2glb.extra_stamp(ldr) + json.dumps(extras)).encode()).hexdigest()[:12]   # (a hand-made part changed: rebuild)
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        glb, src, keyfile = (os.path.join(OUT, slug + ext) for ext in ('.glb', '.ldr', '.key'))
        if not (os.path.exists(glb) and os.path.exists(keyfile) and open(keyfile).read() == key):
            open(src, 'w').write(ldr)
            print(f'  {name}: {ldraw2glb.to_glb(ldraw2glb.glowing(lib.parse(src), ldr), colors, 71, glb, extras)} tris')
            open(keyfile, 'w').write(key)
        built[name] = {'url': f'assets/lego/items/{slug}.glb?v={key}', 'lego': item.get('lego', '')}
        if name in art_num:   # an artifact with a look of its own (the game sends it as this tile: winweb.c web_obj_tile)
            built[name]['vtile'] = ART_TILE + art_num[name]
    json.dump(built, open(os.path.join(LEGO, 'items.built.json'), 'w'), indent=1)
    # every artifact, for the client: its tile, its name, its base item (shown when it has no look of its own)
    json.dump({str(ART_TILE + n): {'name': name, 'base': base} for n, (name, base) in sorted(arts.items())},
              open(os.path.join(LEGO, 'artifacts.built.json'), 'w'), indent=1)
    print(f'artifacts: {len(arts)} ({sum(1 for _, (nm, _) in arts.items() if nm in built)} with a look of their own)')
    print(f'items: {len(built)}')


if __name__ == '__main__':
    main()

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


def main():
    os.makedirs(OUT, exist_ok=True)
    colors = ldraw2glb.load_colors(ldraw2glb.LDRAW)
    lib = ldraw2glb.Library(ldraw2glb.LDRAW)
    built = {}
    for name, item in json.load(open(os.path.join(LEGO, 'items.json'))).items():
        ldr = held_ldr(item)
        key = hashlib.sha1((ldr + ldraw2glb.extra_stamp(ldr)).encode()).hexdigest()[:12]   # (a hand-made part changed: rebuild)
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        glb, src, keyfile = (os.path.join(OUT, slug + ext) for ext in ('.glb', '.ldr', '.key'))
        if not (os.path.exists(glb) and os.path.exists(keyfile) and open(keyfile).read() == key):
            open(src, 'w').write(ldr)
            print(f'  {name}: {ldraw2glb.to_glb(lib.parse(src), colors, 71, glb)} tris')
            open(keyfile, 'w').write(key)
        built[name] = {'url': f'assets/lego/items/{slug}.glb?v={key}', 'lego': item.get('lego', '')}
        if 'vtile' in item:   # an artifact with a look of its own (the game sends it as this tile: winweb.c web_obj_tile)
            built[name]['vtile'] = item['vtile']
    json.dump(built, open(os.path.join(LEGO, 'items.built.json'), 'w'), indent=1)
    print(f'items: {len(built)}')


if __name__ == '__main__':
    main()

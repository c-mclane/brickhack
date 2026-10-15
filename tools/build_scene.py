#!/usr/bin/env python3
"""Build a LEGO scene for the live viewer (web/lego-test.html).

  build_scene.py [web/assets/lego/scene.json]

scene.json lists objects in LDraw units and axes (20 LDU = 1 stud, 24 = a
brick's height, 8 = a plate's; -Y is up, -Z is toward the default camera's far side):

  {"objects": [
     {"part": "3811", "color": 2, "pos": [0, 0, 0]},
     {"fig": "knight", "pos": [0, -24, 0], "rotY": 0}
  ]}

"part" is any LDraw part; "fig" names a minifig recipe in
web/assets/lego/figs/<name>.json (see tools/minifig.py); "item" names a
NetHack item in web/assets/lego/items.json, built from its LEGO parts and
laid on its side on the studs, as if dropped (pos: where on the baseplate);
"tile" names a NetHack item whose game sprite (assets/slashem/tiles.png) the
viewer lays flat beside it. Any object can have a "label". Models are
converted to .glb only when their source changed. The result,
scene.built.json, is what the viewer polls.
"""
import hashlib, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ldraw2glb, minifig

WEB = os.path.join(HERE, '..', 'web')
LEGO = os.path.join(WEB, 'assets', 'lego')
CACHE = os.path.join(LEGO, 'cache')


def item_ldr(lib, item):
    """An item's LEGO parts (items.json) as an LDraw model, laid flat as if
    dropped: turned onto its side (its length, LDraw's Y, along X; the flat of
    a blade facing up), centred, its lowest point resting on the stud tops."""
    R = np.array([[0.0, -1, 0], [1, 0, 0], [0, 0, 1]])   # a quarter turn about Z
    lines, pts = [], []
    for p in item['parts']:
        pos = R @ np.array(p.get('pos', [0, 0, 0]), float)
        lines.append((p.get('color', 16), pos, R, p['part']))
        for _, _, arr, _ in lib.parse(p['part'] + '.dat'):
            pts.append(arr.reshape(-1, 3) @ R.T + pos)
    pts = np.concatenate(pts)
    lo, hi = pts.min(0), pts.max(0)
    shift = np.array([-(lo[0] + hi[0]) / 2, -4 - hi[1], -(lo[2] + hi[2]) / 2])   # (studs are 4 LDU tall)
    return ''.join(minifig.line(c, pos + shift, m, part) + '\n' for c, pos, m, part in lines)


def tile_index(name):
    """The game's tile for a NetHack item, by name (tiles.json lists 'unidentified / real' names)."""
    t = json.load(open(os.path.join(WEB, 'assets', 'slashem', 'tiles.json')))
    for i, n in enumerate(t['names']):
        if n == name or n.split(' / ')[-1] == name:
            return i
    return None


def main(scene_path):
    os.makedirs(CACHE, exist_ok=True)
    scene = json.load(open(scene_path))
    colors = ldraw2glb.load_colors(ldraw2glb.LDRAW)
    lib = ldraw2glb.Library(ldraw2glb.LDRAW)
    built = []
    items = json.load(open(os.path.join(LEGO, 'items.json')))
    for obj in scene['objects']:
        if 'tile' in obj:   # (drawn by the viewer itself)
            built.append({'tile': tile_index(obj['tile']), 'pos': obj.get('pos', [0, 0, 0]), 'label': obj.get('label')})
            continue
        if 'item' in obj:
            text = item_ldr(lib, items[obj['item']])
            key = 'item_' + hashlib.sha1(text.encode()).hexdigest()[:10]
            src, color = os.path.join(CACHE, key + '.ldr'), 16
            if not os.path.exists(src):
                open(src, 'w').write(text)
        elif 'fig' in obj:
            recipe = os.path.join(LEGO, 'figs', obj['fig'] + '.json')
            ldr_text = minifig.build(json.load(open(recipe)), os.path.dirname(recipe))
            # decal images are part of the model too: changing one rebuilds it
            stamp = ldr_text + ''.join(str(os.path.getmtime(l.rsplit(' ', 1)[1])) for l in ldr_text.splitlines() if '!TEXMAP' in l)
            key = 'fig_' + obj['fig'] + '_' + hashlib.sha1(stamp.encode()).hexdigest()[:10]
            src, color = os.path.join(CACHE, key + '.ldr'), 16
            if not os.path.exists(src):
                open(src, 'w').write(ldr_text)
        else:
            color = obj.get('color', 16)
            key = f"{obj['part']}_{color}"
            src = obj['part'] + '.dat'
        glb = os.path.join(CACHE, key + '.glb')
        if not os.path.exists(glb):
            if os.path.exists(src):   # a model we wrote (a figure, an item)
                text = open(src).read()
                geom, extras = ldraw2glb.figure_geom(lib, src, text), ldraw2glb.figure_extras(text)
            else:   # a part from the library
                geom, extras = lib.parse(src), None
            print(f'  converting {key}: {ldraw2glb.to_glb(geom, colors, color if color != 16 else 71, glb, extras)} tris')
        built.append({'url': f'assets/lego/cache/{key}.glb?v={int(os.path.getmtime(glb))}',
                      'pos': obj.get('pos', [0, 0, 0]), 'rotY': obj.get('rotY', 0), 'label': obj.get('label')})
    out = {'objects': built, 'camera': scene.get('camera')}
    out['version'] = hashlib.sha1(json.dumps(out, sort_keys=True).encode()).hexdigest()[:12]
    json.dump(out, open(os.path.join(LEGO, 'scene.built.json'), 'w'), indent=1)
    print(f"scene: {len(built)} objects, version {out['version']}")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(LEGO, 'scene.json'))

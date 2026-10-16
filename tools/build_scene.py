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
web/assets/lego/figs/<name>.json (see tools/minifig.py; "hold": an item of
items.json in its right hand, as the game holds it; "set": recipe keys to
change, e.g. a helm to try on); "item" names a
NetHack item in web/assets/lego/items.json, built from its LEGO parts and
laid on its side on the studs, as if dropped (pos: where on the baseplate;
"stand": true stands it upright instead);
"tile" names a NetHack item whose game sprite (assets/slashem/tiles.png) the
viewer lays flat beside it. Any object can have a "label". Models are
converted to .glb only when their source changed. The result,
scene.built.json, is what the viewer polls.
"""
import hashlib, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_items, ldraw2glb, minifig

WEB = os.path.join(HERE, '..', 'web')
LEGO = os.path.join(WEB, 'assets', 'lego')
CACHE = os.path.join(LEGO, 'cache')


def item_ldr(lib, item, stand=False):
    """An item's LEGO parts (items.json) as an LDraw model, laid flat as if
    dropped, as the game lays it (brickworld.js setItems): as held
    (build_items.held_ldr: its length along Y), turned onto its side (its
    length along X; the flat of a blade facing up), centred, its lowest point
    resting on the stud tops. stand: upright instead, as held (to see a
    polearm's side blades), its foot on the stud tops."""
    R = np.eye(3) if stand else np.array([[0.0, -1, 0], [1, 0, 0], [0, 0, 1]])   # (a quarter turn about Z)
    lines, pts = [], []
    for l in build_items.held_ldr(item).splitlines():
        if l.startswith('0 !TEXMAP NEXT PLANAR '):   # a print on the next part: its three points turned with it
            t = l.split()
            lines.append(('tex', (R @ np.array([float(v) for v in t[4:13]]).reshape(3, 3).T).T, None, ' '.join(t[13:])))
            continue
        if l.startswith('0 '):
            continue
        t = l.split()
        pos = R @ np.array([float(v) for v in t[2:5]])
        mat = R @ np.array([float(v) for v in t[5:14]]).reshape(3, 3)
        part = ' '.join(t[14:])[:-4]
        lines.append((t[1], pos, mat, part))
        for _, _, arr, _ in lib.parse(part + '.dat'):
            pts.append(arr.reshape(-1, 3) @ mat.T + pos)
    pts = np.concatenate(pts)
    lo, hi = pts.min(0), pts.max(0)
    shift = np.array([-(lo[0] + hi[0]) / 2, -4 - hi[1], -(lo[2] + hi[2]) / 2])   # (studs are 4 LDU tall)
    out = ''
    for c, pos, m, part in lines:
        if c == 'tex':
            out += '0 !TEXMAP NEXT PLANAR ' + ' '.join(f'{v:.4f}' for v in (pos + shift).flatten()) + ' ' + part + '\n'
        else:
            out += minifig.line(c, pos + shift, m, part) + '\n'
    return out


def hold_item(ldr_text, item):
    """A figure (minifig.build's text) with an item (items.json) in its right
    hand, just as the game holds it (brickworld.js holdItems): the item as
    held (build_items.held_ldr) placed at the right arm's grip (the rig's,
    minifig.grip_frame), on a joint of its own; the arm marked as holding,
    so the viewer raises it as the game does."""
    lines = ldr_text.splitlines()
    i = next(i for i, l in enumerate(lines) if l.startswith('0 !LEGOHACK RIG '))
    rig = json.loads(lines[i][len('0 !LEGOHACK RIG '):])
    rig['armR']['holds'] = True
    lines[i] = '0 !LEGOHACK RIG ' + json.dumps(rig, separators=(',', ':'))
    gp, gm = np.array(rig['armR']['grip']['pos']), np.array(rig['armR']['grip']['mat']).reshape(3, 3)
    lines.append('0 !LEGOHACK GROUP itemR')
    for l in build_items.held_ldr(item).splitlines():
        if l.startswith('0 '):   # (a print: not shown here)
            continue
        t = l.split()
        pos, mat = np.array([float(v) for v in t[2:5]]), np.array([float(v) for v in t[5:14]]).reshape(3, 3)
        lines.append(minifig.line(t[1], gp + gm @ pos, gm @ mat, ' '.join(t[14:])[:-4]))
    return '\n'.join(lines) + '\n'


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
            item = {'parts': obj['parts']} if 'parts' in obj else items[obj['item']]   # (or its own parts: a variant)
            if 'parts' not in item and item.get('wear', {}).get('boots'):   # (boots: their parts made from the bands)
                item = dict(item, parts=build_items.boot_parts(item['wear']['boots']))
            text = item_ldr(lib, item, obj.get('stand', item.get('upright', False)))   # (food stands as the game sets it down)
            aura = item.get('aura')
            if aura:   # an angel's glow round it (ldraw2glb.figure_extras); a tip's end: up standing, glTF +X lying down
                if isinstance(aura, dict) and 'tip' in aura:
                    aura = dict(aura, tip=dict({'dir': [0, 1, 0] if obj.get('stand') else [1, 0, 0]}, **aura['tip']))
                text = '0 !LEGOHACK AURA' + (' ' + json.dumps(aura) if isinstance(aura, dict) else '') + '\n' + text
            if item.get('lightning'):   # lightning crackling over it (mist.js addLightning)
                text = '0 !LEGOHACK LIGHTNING\n' + text
            if item.get('glow'):   # its tip glowing (ldraw2glb.glowing): the tip is up when it stands, +X lying down
                g = item['glow']
                text = f"0 !LEGOHACK GLOW {'0 -1' if obj.get('stand') else '1 0'} 0 {g['fraction']} {g['color']}\n" + text
            key = 'item_' + hashlib.sha1((text + ldraw2glb.extra_stamp(text)).encode()).hexdigest()[:10]
            src, color = os.path.join(CACHE, key + '.ldr'), 16
            if not os.path.exists(src):
                open(src, 'w').write(text)
        elif 'fig' in obj:
            recipe = os.path.join(LEGO, 'figs', obj['fig'] + '.json')
            spec = json.load(open(recipe))
            spec.update(obj.get('set', {}))   # recipe keys to change (a helm to try on: "hat", "hatColor"...)
            if obj.get('hold'):
                spec.pop('right', None)   # (its own hand items make way)
                spec.pop('left', None)
            ldr_text = minifig.build(spec, os.path.dirname(recipe))
            if obj.get('hold'):
                ldr_text = hold_item(ldr_text, items[obj['hold']])
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

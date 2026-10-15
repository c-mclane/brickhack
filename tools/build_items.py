#!/usr/bin/env python3
"""Build the LEGO versions of NetHack's items (web/assets/lego/items.json).

  build_items.py

Each item's parts, as they'd be held: in the item's own frame, its grip at the
origin, a blade pointing up (LDraw: -Y), so the same model serves for an item
in a hand and, laid down by the game, on the floor (brickworld.js). Writes
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


def main():
    os.makedirs(OUT, exist_ok=True)
    colors = ldraw2glb.load_colors(ldraw2glb.LDRAW)
    lib = ldraw2glb.Library(ldraw2glb.LDRAW)
    built = {}
    for name, item in json.load(open(os.path.join(LEGO, 'items.json'))).items():
        ldr = ''.join(minifig.line(p.get('color', 16), p.get('pos', [0, 0, 0]), np.eye(3), p['part']) + '\n' for p in item['parts'])
        key = hashlib.sha1(ldr.encode()).hexdigest()[:12]
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        glb, src, keyfile = (os.path.join(OUT, slug + ext) for ext in ('.glb', '.ldr', '.key'))
        if not (os.path.exists(glb) and os.path.exists(keyfile) and open(keyfile).read() == key):
            open(src, 'w').write(ldr)
            print(f'  {name}: {ldraw2glb.to_glb(lib.parse(src), colors, 71, glb)} tris')
            open(keyfile, 'w').write(key)
        built[name] = {'url': f'assets/lego/items/{slug}.glb?v={key}', 'lego': item.get('lego', '')}
    json.dump(built, open(os.path.join(LEGO, 'items.built.json'), 'w'), indent=1)
    print(f'items: {len(built)}')


if __name__ == '__main__':
    main()

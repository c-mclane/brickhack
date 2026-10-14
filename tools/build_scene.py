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
web/assets/lego/figs/<name>.json (see tools/minifig.py). Models are converted
to .glb only when their source changed. The result, scene.built.json, is
what the viewer polls.
"""
import hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ldraw2glb, minifig

WEB = os.path.join(HERE, '..', 'web')
LEGO = os.path.join(WEB, 'assets', 'lego')
CACHE = os.path.join(LEGO, 'cache')


def main(scene_path):
    os.makedirs(CACHE, exist_ok=True)
    scene = json.load(open(scene_path))
    colors = ldraw2glb.load_colors(ldraw2glb.LDRAW)
    lib = ldraw2glb.Library(ldraw2glb.LDRAW)
    built = []
    for obj in scene['objects']:
        if 'fig' in obj:
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
            print(f'  converting {key}: {ldraw2glb.to_glb(lib.parse(src), colors, color if color != 16 else 71, glb)} tris')
        built.append({'url': f'assets/lego/cache/{key}.glb?v={int(os.path.getmtime(glb))}',
                      'pos': obj.get('pos', [0, 0, 0]), 'rotY': obj.get('rotY', 0)})
    out = {'objects': built, 'camera': scene.get('camera')}
    out['version'] = hashlib.sha1(json.dumps(out, sort_keys=True).encode()).hexdigest()[:12]
    json.dump(out, open(os.path.join(LEGO, 'scene.built.json'), 'w'), indent=1)
    print(f"scene: {len(built)} objects, version {out['version']}")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(LEGO, 'scene.json'))

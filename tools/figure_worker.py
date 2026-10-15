#!/usr/bin/env python3
"""Builds customized minifigs for the game server (server/server.js), one per
line of JSON on stdin: {"id": n, "base": "<roster figure>", "parts": {category:
option id}}. Answers a line of JSON: {"id": n, "url": ...} or {"id": n, "error": ...}.
Figures go to web/assets/lego/custom/<key>.glb (kept, so a repeat is instant).
Stays running so the parts library stays loaded."""
import hashlib, json, os, sys, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ldraw2glb, minifig, wardrobe

OUT = os.path.join(wardrobe.LEGO, 'custom')


def main():
    os.makedirs(OUT, exist_ok=True)
    colors = ldraw2glb.load_colors(ldraw2glb.LDRAW)
    lib = ldraw2glb.Library(ldraw2glb.LDRAW)
    roster = set(json.load(open(os.path.join(wardrobe.LEGO, 'roster.json'))))
    for raw in sys.stdin:
        req = {}
        try:
            req = json.loads(raw)
            base = str(req.get('base', ''))
            if base not in roster:
                raise ValueError(f'no figure {base!r}')
            ward = wardrobe.load_wardrobe()
            parts = {str(k): str(v) for k, v in (req.get('parts') or {}).items()}
            spec = wardrobe.empty_handed(wardrobe.customize(wardrobe.recipe(base), parts, ward))
            wear = [w for w in str(req.get('wear') or '').split(',') if w]   # worn things (items.json), by name: a helm, a shield
            if wear:
                items = json.load(open(os.path.join(wardrobe.LEGO, 'items.json')))
                for w in wear:
                    if w not in items:
                        raise ValueError(f'no item {w!r}')
                    spec = wardrobe.wearing(spec, items[w])
            ldr = minifig.build(spec, wardrobe.FIGS)
            key = hashlib.sha1(ldr.encode()).hexdigest()[:16]
            glb = os.path.join(OUT, key + '.glb')
            if not os.path.exists(glb):
                ldr_path = os.path.join(OUT, key + '.ldr')
                open(ldr_path, 'w').write(ldr)
                ldraw2glb.to_glb(ldraw2glb.figure_geom(lib, ldr_path, ldr), colors, 71, glb, ldraw2glb.figure_extras(ldr))
            out = {'id': req.get('id'), 'url': f'assets/lego/custom/{key}.glb'}
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            out = {'id': req.get('id'), 'error': str(e)}
        sys.stdout.write(json.dumps(out) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Build the playable minifig roster for the game's character select.

  build_roster.py

Reads web/assets/brick/roster.json (figure names, in shelf order) and each
recipe in web/assets/brick/figs/, and writes:
  web/assets/brick/roster/<name>.glb   the figure (rebuilt only when it changed)
  web/assets/brick/roster.built.json   [{id, label, url}] for the client
and the dungeon's brick pieces (DUNGEON_PARTS) as web/assets/brick/parts/<name>.glb.

Monsters made in brick (web/assets/brick/monsters.json: {"<NetHack name>":
{"fig": recipe, "hold": an item of items.json in its right hand}}) are built
the same way, listed in web/assets/brick/monsters.built.json for the client.
"""
import hashlib, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ldraw2glb, minifig, wardrobe

ASSETS = os.path.join(HERE, '..', 'web', 'assets', 'brick')
OUT = os.path.join(ASSETS, 'roster')
PARTS = os.path.join(ASSETS, 'parts')

# The dungeon's pieces, as LDraw models (origin: the top middle of the frame).
# A 1x4x6 door frame (60596) with its door (60616a) on the frame's hinge pins
# at x = -32, z = 5: shut, swung open a quarter turn, or missing (a doorway).
FRAME, DOOR = 308, 70   # wooden: a dark brown frame, a reddish brown door
DUNGEON_PARTS = {
    'door_closed': f"""1 {FRAME} 0 0 0 1 0 0 0 1 0 0 0 1 60596.dat
1 {DOOR} -32 0 5 1 0 0 0 1 0 0 0 1 60616a.dat
""",
    'door_open': f"""1 {FRAME} 0 0 0 1 0 0 0 1 0 0 0 1 60596.dat
1 {DOOR} -32 0 5 0 0 1 0 1 0 -1 0 0 60616a.dat
""",
    'doorway': f"""1 {FRAME} 0 0 0 1 0 0 0 1 0 0 0 1 60596.dat
""",
    # the dungeon itself: a grey 4x4 plate for each floor square, grey 2x4 bricks for the walls
    # (the floor the grey of the walls' top course)
    'plate4x4': """1 71 0 0 0 1 0 0 0 1 0 0 0 1 3031.dat
""",
    'brick2x4': """1 71 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat
""",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    colors = ldraw2glb.load_colors(ldraw2glb.LDRAW)
    lib = ldraw2glb.Library(ldraw2glb.LDRAW)
    figs = os.path.join(ASSETS, 'figs')
    built = []

    def figure(name, character=True):
        """Build a recipe (when it changed): (its spec, its url). A character
        holds nothing of its own (wardrobe.empty_handed): the game gives it
        what it wields."""
        spec = json.load(open(os.path.join(figs, name + '.json')))
        if character:   # (its base merged in first: the base's hands are emptied too)
            spec = wardrobe.empty_handed(wardrobe.recipe(name))
        ldr = minifig.build(spec, figs)
        # decal images count too: a changed picture rebuilds the figure
        stamp = ldr + ''.join(str(os.path.getmtime(l.rsplit(' ', 1)[1])) for l in ldr.splitlines() if '!TEXMAP' in l) + ldraw2glb.extra_stamp(ldr)
        key = hashlib.sha1(stamp.encode()).hexdigest()[:12]
        glb, ldr_path, keyfile = (os.path.join(OUT, name + ext) for ext in ('.glb', '.ldr', '.key'))
        if not (os.path.exists(glb) and os.path.exists(keyfile) and open(keyfile).read() == key):
            open(ldr_path, 'w').write(ldr)
            print(f'  {name}: {ldraw2glb.to_glb(ldraw2glb.figure_geom(lib, ldr_path, ldr), colors, 71, glb, ldraw2glb.figure_extras(ldr))} tris')
            open(keyfile, 'w').write(key)
        return spec, f'assets/brick/roster/{name}.glb?v={key}'

    for name in json.load(open(os.path.join(ASSETS, 'roster.json'))):
        spec, url = figure(name)
        full = wardrobe.recipe(name)   # (as designed: its hands not emptied)
        built.append({'id': name, 'label': spec.get('label', name), 'url': url,
                      'role': spec.get('role', 'knight'), 'gender': spec.get('gender', 'male'),
                      'race': spec.get('race', 'human'),
                      # more it starts the game with than its role's own kit ("holy wafer:4,..."): winweb.c web_kit_item
                      **({'kit': spec['kit']} if spec.get('kit') else {}),
                      # its own deity ("Jesus": winweb's BRICKHACK_GOD, role.c) and gifts ("chalice": winweb.c web_fill_glasses)
                      **({k: spec[k] for k in ('god', 'perks') if spec.get(k)}),
                      # the slots its design fills: starting gear shows only where it takes the place of something
                      'slots': {'helm': bool(full.get('hat')),
                                'cloak': any(wardrobe.is_cape(n) for n in (full.get('neck') or []) if isinstance(n, dict))
                                         or (isinstance(full.get('neck'), dict) and wardrobe.is_cape(full['neck'])),
                                'shield': bool(full.get('left')),
                                'suit': any(wardrobe.is_armour(n) for n in wardrobe.necklist(full)),
                                'boots': bool(full.get('boots'))}})
    json.dump(built, open(os.path.join(ASSETS, 'roster.built.json'), 'w'), indent=1)
    print(f'roster: {len(built)} figures')
    mons = {}
    def creature(mon, m):
        """A monster that isn't a minifig (a cobra): its parts ({part, color, pos, mat}), scaled down to fit
        its square ("scale"), its middle over the origin and its underside on it; facing +Z as a figure
        does (its head to LDraw's -Z). Animated whole by the client (web/js/creature.js)."""
        s = m.get('scale', 1)
        shift = np.zeros(3)
        if m['creature'] in ('beast', 'fungus', 'float', 'bat') or m.get('center'):   # (an animal: stood on its square, its feet on the floor, its middle over it)
            pts = []
            for p in m['parts']:
                M = np.array(p.get('mat', [1, 0, 0, 0, 1, 0, 0, 0, 1]), float).reshape(3, 3)
                for _, _, arr, _ in lib.parse(p['part'] + '.dat'):
                    pts.append(arr.reshape(-1, 3) @ M.T + np.array(p.get('pos', [0, 0, 0]), float))
            pts = np.concatenate(pts)
            lo, hi = pts.min(0), pts.max(0)
            shift = np.array([-(lo[0] + hi[0]) / 2, -hi[1], -(lo[2] + hi[2]) / 2])   # (LDraw's down is +Y)
        ldr = f'0 {mon}\n' + ''.join(f"1 {p['color']} " + ' '.join(str(round((v + d) * s, 3)) for v, d in zip(p.get('pos', [0, 0, 0]), shift))
                                      + ' ' + ' '.join(str(round(v * s, 4)) for v in p.get('mat', [1, 0, 0, 0, 1, 0, 0, 0, 1]))
                                      + f" {p['part']}.dat\n" for p in m['parts'])
        name = 'mon-' + mon.replace(' ', '-')
        extras = {'fx': m['fx']} if m.get('fx') else None   # (its element in particles all over it: a hell hound's fire, mist.js addEffects)
        key = hashlib.sha1((ldr + json.dumps(extras)).encode()).hexdigest()[:12]
        glb, ldr_path, keyfile = (os.path.join(OUT, name + ext) for ext in ('.glb', '.ldr', '.key'))
        if not (os.path.exists(glb) and os.path.exists(keyfile) and open(keyfile).read() == key):
            open(ldr_path, 'w').write(ldr)
            print(f'  {name}: {ldraw2glb.to_glb(lib.parse(ldr_path), colors, 71, glb, extras)} tris')
            open(keyfile, 'w').write(key)
        return f'assets/brick/roster/{name}.glb?v={key}'

    for mon, m in json.load(open(os.path.join(ASSETS, 'monsters.json'))).items():
        if m.get('creature'):
            mons[mon] = {'url': creature(mon, m), 'creature': m['creature']}
            continue
        mons[mon] = {'url': figure(m['fig'], character=False)[1], 'hold': m.get('hold'),
                     # a serpent's tail for legs (a naga): it slithers (web/js/creature.js slitherLocal), lifted so its coils rest on the floor
                     **({'slither': True} if m.get('slither') else {}), **({'lift': m['lift']} if m.get('lift') else {})}
    json.dump(mons, open(os.path.join(ASSETS, 'monsters.built.json'), 'w'), indent=1)
    print(f'monsters in brick: {len(mons)}')
    os.makedirs(PARTS, exist_ok=True)
    for name, ldr in DUNGEON_PARTS.items():
        glb, src, keyfile = (os.path.join(PARTS, name + ext) for ext in ('.glb', '.ldr', '.key'))
        key = hashlib.sha1(ldr.encode()).hexdigest()[:12]
        if not (os.path.exists(glb) and os.path.exists(keyfile) and open(keyfile).read() == key):
            open(src, 'w').write(ldr)
            print(f'  {name}: {ldraw2glb.to_glb(lib.parse(src), colors, 71, glb)} tris')
            open(keyfile, 'w').write(key)
    print(f'dungeon parts: {len(DUNGEON_PARTS)}')


if __name__ == '__main__':
    main()

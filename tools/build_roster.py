#!/usr/bin/env python3
"""Build the playable minifig roster for the game's character select.

  build_roster.py

Reads web/assets/lego/roster.json (figure names, in shelf order) and each
recipe in web/assets/lego/figs/, and writes:
  web/assets/lego/roster/<name>.glb   the figure (rebuilt only when it changed)
  web/assets/lego/roster.built.json   [{id, label, url}] for the client
and the dungeon's LEGO pieces (DUNGEON_PARTS) as web/assets/lego/parts/<name>.glb.

Monsters made in LEGO (web/assets/lego/monsters.json: {"<NetHack name>":
{"fig": recipe, "hold": an item of items.json in its right hand}}) are built
the same way, listed in web/assets/lego/monsters.built.json for the client.
"""
import hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ldraw2glb, minifig, wardrobe

LEGO = os.path.join(HERE, '..', 'web', 'assets', 'lego')
OUT = os.path.join(LEGO, 'roster')
PARTS = os.path.join(LEGO, 'parts')

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
    # the dungeon itself: a green 4x4 plate for each floor square, grey 2x4 bricks for the walls
    'plate4x4': """1 2 0 0 0 1 0 0 0 1 0 0 0 1 3031.dat
""",
    'brick2x4': """1 71 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat
""",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    colors = ldraw2glb.load_colors(ldraw2glb.LDRAW)
    lib = ldraw2glb.Library(ldraw2glb.LDRAW)
    figs = os.path.join(LEGO, 'figs')
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
        return spec, f'assets/lego/roster/{name}.glb?v={key}'

    for name in json.load(open(os.path.join(LEGO, 'roster.json'))):
        spec, url = figure(name)
        full = wardrobe.recipe(name)   # (as designed: its hands not emptied)
        built.append({'id': name, 'label': spec.get('label', name), 'url': url,
                      'role': spec.get('role', 'knight'), 'gender': spec.get('gender', 'male'),
                      'race': spec.get('race', 'human'),
                      # the slots its design fills: starting gear shows only where it takes the place of something
                      'slots': {'helm': bool(full.get('hat')),
                                'cloak': any(wardrobe.is_cape(n) for n in (full.get('neck') or []) if isinstance(n, dict))
                                         or (isinstance(full.get('neck'), dict) and wardrobe.is_cape(full['neck'])),
                                'shield': bool(full.get('left'))}})
    json.dump(built, open(os.path.join(LEGO, 'roster.built.json'), 'w'), indent=1)
    print(f'roster: {len(built)} figures')
    mons = {}
    for mon, m in json.load(open(os.path.join(LEGO, 'monsters.json'))).items():
        mons[mon] = {'url': figure(m['fig'], character=False)[1], 'hold': m.get('hold')}
    json.dump(mons, open(os.path.join(LEGO, 'monsters.built.json'), 'w'), indent=1)
    print(f'monsters in LEGO: {len(mons)}')
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

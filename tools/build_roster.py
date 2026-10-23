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
UI_GLYPHS = {'A': '3070bpta', 'B': '3070bptb', 'C': '3070bptc', 'D': '3070bptd', 'E': '3070bpte', 'F': '3070bptf', 'G': '3070bptg', 'H': '3070bpth', 'I': '3070bpti', 'J': '3070bptj', 'K': '3070bptk', 'L': '3070bptl', 'M': '3070bptm', 'N': '3070bptn', 'O': '3070bpto', 'P': '3070bptp', 'Q': '3070bptq', 'R': '3070bptr', 'S': '3070bpts', 'T': '3070bptt', 'U': '3070bptu', 'V': '3070bptv', 'W': '3070bptw', 'X': '3070bptx', 'Y': '3070bpty', 'Z': '3070bptz', '0': '3070bpv0', '1': '3070bpv1', '2': '3070bpv2', '3': '3070bpv3', '4': '3070bpv4', '5': '3070bpv5', '6': '3070bpv6', '7': '3070bpv7', '8': '3070bpv8', '-': '3070bpuh', '.': '3070bpuf', '@': '3070bpuj', '_': '3070bpug'}   # (the silver letter tiles: char -> part)
DUNGEON_PARTS = {
    # the pieces a zap's light is made of (web/js/spellfx.js): white, tinted there to each wand's and spell's colour
    'fx_stud': "1 15 0 0 0 1 0 0 0 1 0 0 0 1 6141.dat\n",      # (a round 1x1 plate)
    'fx_star': "1 15 0 0 0 1 0 0 0 1 0 0 0 1 11609.dat\n",     # (a round 1x1 plate with a star on top)
    'fx_heart': "1 15 0 0 0 1 0 0 0 1 0 0 0 1 39739.dat\n",    # (a heart tile: healing)
    'fx_flame': "1 15 0 0 0 1 0 0 0 1 0 0 0 1 6126b.dat\n",    # (a minifig flame: fire)
    'fx_bolt': "1 15 0 0 0 1 0 0 0 1 0 0 0 1 59233.dat\n",     # (a minifig lightning bolt: lightning)
    'fx_gem': "1 15 0 0 0 1 0 0 0 1 0 0 0 1 30153.dat\n",      # (a faceted gem: ice)
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
    # the Gnomish Mines (brickworld.js minesWalls): its floor, reddish brown plates; its walls, tiled along each run
    # of wall: rock panels (10 studs long, 4 deep, 6 bricks tall: a wall's height), the rest in rock columns (two
    # 4x4x3 rocks, the upper turned) and, a run 2 studs short, a stack of 2x4 bricks; all in the rock's grey (a
    # panel in dark tan too), origin at its top middle
    'plate4x4_mines': """1 70 0 0 0 1 0 0 0 1 0 0 0 1 3031.dat
""",
    'mines_panel_a': """1 72 0 0 0 1 0 0 0 1 0 0 0 1 6082.dat
""",
    'mines_panel_b': """1 28 0 0 0 1 0 0 0 1 0 0 0 1 6082.dat
""",
    'mines_rock4': """1 72 0 72 0 1 0 0 0 1 0 0 0 1 30294c01.dat
1 72 0 0 0 0 0 1 0 1 0 -1 0 0 30294c01.dat
""",
    'mines_fill2': ''.join(f"1 72 0 {24 * i} 0 0 0 1 0 1 0 -1 0 0 3001.dat\n" for i in range(6)),
    # stairs (render.js: a stair's square): built of 1x4 bricks, a square's width, four steps running from its front
    # toward its back (LDraw +Z: turned to run toward a wall), in brown (reddish brown treads, dark brown under). Down: no floor, the steps going down into the hole a
    # brick at a time (the deeper, the darker the shadow on them), into the black; up: the steps rising out of the floor, a brick at a time
    'stairs_down': """1 70 0 8 -30 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 32 -30 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 56 -30 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 80 -30 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 104 -30 1 0 0 0 1 0 0 0 1 3010.dat
1 70 0 32 -10 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 56 -10 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 80 -10 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 104 -10 1 0 0 0 1 0 0 0 1 3010.dat
1 70 0 56 10 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 80 10 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 104 10 1 0 0 0 1 0 0 0 1 3010.dat
1 70 0 80 30 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 104 30 1 0 0 0 1 0 0 0 1 3010.dat
""",
    'stairs_up': """1 70 0 -24 -30 1 0 0 0 1 0 0 0 1 3010.dat
1 70 0 -48 -10 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 -24 -10 1 0 0 0 1 0 0 0 1 3010.dat
1 70 0 -72 10 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 -48 10 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 -24 10 1 0 0 0 1 0 0 0 1 3010.dat
1 70 0 -96 30 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 -72 30 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 -48 30 1 0 0 0 1 0 0 0 1 3010.dat
1 308 0 -24 30 1 0 0 0 1 0 0 0 1 3010.dat
""",
    # the status bars' icons (web/js/ui.js hudIcons: each drawn once, a little picture): a heart of two red 3x2 plates
    # with a hole, their round ends its lobes, crossed at its point, studs to you; a turkey leg (food); an armour plate
    # (armour class); a clear round 1x1 plate, a bubble (power)
    'hud_heart': """1 4 -0.000 -28.284 -0.400 -0.7071 -0.0000 0.7071 0.7071 -0.0000 0.7071 0.0000 1.0000 0.0000 3176.dat
1 4 -0.000 -28.284 0.400 -0.7071 0.0000 -0.7071 -0.7071 -0.0000 0.7071 0.0000 1.0000 0.0000 3176.dat
""",
    'hud_food': """1 70 0 0 0 1 0 0 0 1 0 0 0 1 33057.dat
""",
    'hud_armor': """1 80 0 0 0 1 0 0 0 1 0 0 0 1 2587.dat
""",
    'hud_bubble': """1 43 0 0 0 1 0 0 0 1 0 0 0 1 6141.dat
""",
    # the interface in brick (web/js/brickui.js): a white 1x1 plate (tinted, a button's colour, laid in a row: its
    # plate), and a black 1x1 tile printed with each silver letter there is (no 9: the 6 turned round), spelling on it
    'ui_plate': """1 15 0 0 0 1 0 0 0 1 0 0 0 1 3024.dat
""",
    **{f'ui_glyph_{ord(c)}': f'1 0 0 0 0 1 0 0 0 1 0 0 0 1 {part}.dat\n' for c, part in UI_GLYPHS.items()},
    # water (a pool, a moat): clear blue 1x1 round plates, heaped in the square's hole and roiling
    'water_stud': """1 43 0 0 0 1 0 0 0 1 0 0 0 1 6141.dat
""",    # ...and the bottom of its hole, still under them: the same clear blue 1x1 round plates, one on each of the
    # square's 16 studs and 9 more between them, a little deeper (no floor to be seen through the water)
    'water_bed': """1 43 -30 0 -30 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -30 0 -10 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -30 0 10 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -30 0 30 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -10 0 -30 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -10 0 -10 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -10 0 10 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -10 0 30 1 0 0 0 1 0 0 0 1 6141.dat
1 43 10 0 -30 1 0 0 0 1 0 0 0 1 6141.dat
1 43 10 0 -10 1 0 0 0 1 0 0 0 1 6141.dat
1 43 10 0 10 1 0 0 0 1 0 0 0 1 6141.dat
1 43 10 0 30 1 0 0 0 1 0 0 0 1 6141.dat
1 43 30 0 -30 1 0 0 0 1 0 0 0 1 6141.dat
1 43 30 0 -10 1 0 0 0 1 0 0 0 1 6141.dat
1 43 30 0 10 1 0 0 0 1 0 0 0 1 6141.dat
1 43 30 0 30 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -20 3 -20 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -20 3 0 1 0 0 0 1 0 0 0 1 6141.dat
1 43 -20 3 20 1 0 0 0 1 0 0 0 1 6141.dat
1 43 0 3 -20 1 0 0 0 1 0 0 0 1 6141.dat
1 43 0 3 0 1 0 0 0 1 0 0 0 1 6141.dat
1 43 0 3 20 1 0 0 0 1 0 0 0 1 6141.dat
1 43 20 3 -20 1 0 0 0 1 0 0 0 1 6141.dat
1 43 20 3 0 1 0 0 0 1 0 0 0 1 6141.dat
1 43 20 3 20 1 0 0 0 1 0 0 0 1 6141.dat
""",
    # lava: the same heap, roiling, in clear neon orange, glowing; on a bed of clear red
    'lava_stud': """1 38 0 0 0 1 0 0 0 1 0 0 0 1 6141.dat
""",
    'lava_bed': """1 36 -30 0 -30 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -30 0 -10 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -30 0 10 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -30 0 30 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -10 0 -30 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -10 0 -10 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -10 0 10 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -10 0 30 1 0 0 0 1 0 0 0 1 6141.dat
1 36 10 0 -30 1 0 0 0 1 0 0 0 1 6141.dat
1 36 10 0 -10 1 0 0 0 1 0 0 0 1 6141.dat
1 36 10 0 10 1 0 0 0 1 0 0 0 1 6141.dat
1 36 10 0 30 1 0 0 0 1 0 0 0 1 6141.dat
1 36 30 0 -30 1 0 0 0 1 0 0 0 1 6141.dat
1 36 30 0 -10 1 0 0 0 1 0 0 0 1 6141.dat
1 36 30 0 10 1 0 0 0 1 0 0 0 1 6141.dat
1 36 30 0 30 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -20 3 -20 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -20 3 0 1 0 0 0 1 0 0 0 1 6141.dat
1 36 -20 3 20 1 0 0 0 1 0 0 0 1 6141.dat
1 36 0 3 -20 1 0 0 0 1 0 0 0 1 6141.dat
1 36 0 3 0 1 0 0 0 1 0 0 0 1 6141.dat
1 36 0 3 20 1 0 0 0 1 0 0 0 1 6141.dat
1 36 20 3 -20 1 0 0 0 1 0 0 0 1 6141.dat
1 36 20 3 0 1 0 0 0 1 0 0 0 1 6141.dat
1 36 20 3 20 1 0 0 0 1 0 0 0 1 6141.dat
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
    def creature(mon, m, saddled=False):
        """A monster that isn't a minifig (a cobra): its parts ({part, color, pos, mat}), scaled down to fit
        its square ("scale"), its middle over the origin and its underside on it; facing +Z as a figure
        does (its head to LDraw's -Z). Animated whole by the client (web/js/creature.js)."""
        s = m.get('scale', 1)
        shift = np.zeros(3)
        if saddled: m = {**m, 'parts': m['parts'] + m['saddle']}   # (saddled: a steed's saddle on its back, for a rider)
        if m['creature'] in ('beast', 'horse', 'fungus', 'float', 'eye', 'bat') or m.get('center'):   # (an animal: stood on its square, its feet on the floor, its middle over it)
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
        name = 'mon-' + mon.replace(' ', '-') + ('-saddled' if saddled else '')
        extras = {'fx': m['fx']} if m.get('fx') else None   # (its element in particles all over it: a hell hound's fire, mist.js addEffects)
        if m.get('aura'): extras = {**(extras or {}), 'aura': m['aura']}   # (an angel's glowing corona round it: mist.js addAura)
        key = hashlib.sha1((ldr + json.dumps(extras)).encode()).hexdigest()[:12]
        glb, ldr_path, keyfile = (os.path.join(OUT, name + ext) for ext in ('.glb', '.ldr', '.key'))
        if not (os.path.exists(glb) and os.path.exists(keyfile) and open(keyfile).read() == key):
            open(ldr_path, 'w').write(ldr)
            print(f'  {name}: {ldraw2glb.to_glb(lib.parse(ldr_path), colors, 71, glb, extras)} tris')
            open(keyfile, 'w').write(key)
        url = f'assets/brick/roster/{name}.glb?v={key}'
        if m.get('rider') and not saddled:   # (a centaur: its man half a figure of its own, animated, set where its neck is ("riderAt", in the parts' frame): in the model's units, and its scale)
            at = (np.array(m['riderAt'], float) + shift) * s / 20 * np.array([1, -1, -1])
            return url, {'url': figure(m['rider'], character=False)[1], 'at': at.round(4).tolist(), 'scale': s}
        return url

    monsters = json.load(open(os.path.join(ASSETS, 'monsters.json')))
    for mon, m in monsters.items():
        if m.get('creature'):
            url = creature(mon, m)
            if m.get('rider'):
                url, rider = url
                mons[mon] = {'url': url, 'creature': m['creature'], 'rider': rider, 'hold': m.get('hold'), **({'archer': True} if m.get('archer') else {})}
                continue
            mons[mon] = {'url': url, 'creature': m['creature'],
                         **({'saddled': creature(mon, m, True), 'seat': m.get('seat', 1)} if m.get('saddle') else {})}   # (with a saddle on: ridden; how high its seat)
            continue
        mons[mon] = {'url': figure(m['fig'], character=False)[1], 'hold': m.get('hold'), **({'archer': True} if m.get('archer') else {}),   # (archer: shoots with a bow: drawn and loosed in the stance, FOUNT.loose)
                     # a serpent's tail for legs (a naga): it slithers (web/js/creature.js slitherLocal), lifted so its coils rest on the floor
                     **({'slither': True} if m.get('slither') else {}), **({'lift': m['lift']} if m.get('lift') else {})}
    for mon, m in monsters.items():   # (a hallucination's: drawn for a monster going by that made-up name, not its own; several can share one name ("bogus"), one of them picked for each monster)
        if m.get('bogus') and mon in mons:
            mons[mon]['bogus'] = m['bogus'] if isinstance(m['bogus'], str) else mon
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

#!/usr/bin/env python3
"""Build the brick versions of NetHack's items (web/assets/brick/items.json).

  build_items.py

Each item's parts, as they'd be held (held_ldr): its grip at the origin, a
blade pointing up (LDraw: -Y), its flat toward +X, so the same model serves
for an item in a hand (a figure's rig has each hand's grip: minifig.grip_frame)
and, laid down by the game, on the floor (brickworld.js). Writes
  web/assets/brick/items/<name>.glb      (rebuilt only when it changed)
  web/assets/brick/items.built.json      {name: {url, brick}}
"""
import hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ldraw2glb, minifig, objclasses
import numpy as np

ASSETS = os.path.join(HERE, '..', 'web', 'assets', 'brick')
OUT = os.path.join(ASSETS, 'items')


def held_ldr(item):
    """The item as held: its main (first) part's grip (minifig.HELD) centred
    on the origin, the end that leaves the top of a fist up (-Y), the flat of
    a blade (its 'face') toward +X; the other parts placed with it (each
    turned by its own "mat" and/or "rot", if given, as a figure's extras are;
    a "decal" printed on it, as on a figure's neck items; "stripes" moulded
    in it, minifig.striped)."""
    info = minifig.held_info(item['parts'][0]['part'])
    R = minifig.frame(info['up']).T   # the item's 'up' onto -Y
    if 'face' in info:   # ...and turned about Y to bring its face round to +X
        f = R @ minifig.unit(info['face'])
        a = np.arctan2(f[2], f[0])
        R = minifig.rot_axis((0, 1, 0), a) @ R
    c = np.array(info['center'], float)
    out = ''
    jointed = any(p.get('joint') for p in item['parts'])   # (a part that moves on its own: a chest's lid)
    group = None
    for p in item['parts']:
        if jointed and (p.get('joint') or 'body') != group:
            group = p.get('joint') or 'body'
            out += f'0 !BRICKHACK GROUP {group}\n'
        M = np.array(p['mat'], float).reshape(3, 3) if 'mat' in p else np.eye(3)   # a whole turn, as LDraw writes one (rows)
        for r in p.get('rot', []):   # turns, in order: {"axis": [x, y, z], "deg": d}
            M = minifig.rot_axis(r['axis'], np.radians(r['deg'])) @ M
        part = minifig.striped(p['part'], **p['stripes']) if p.get('stripes') else p['part']   # (moulded with stripes: a watermelon)
        pos = R @ (np.array(p.get('pos', [0, 0, 0]), float) - c)
        if p.get('decal'):   # a print on it (a mail shirt's rings: decals/, paths from the items folder)
            out += minifig.decal_line(p, pos, R @ M, OUT) + '\n'
        out += minifig.line(p.get('color', 16), pos, R @ M, part) + '\n'
    return out


def held_point(item, point):
    """A point given in the item's own parts' frame, where held_ldr puts it."""
    info = minifig.held_info(item['parts'][0]['part'])
    R = minifig.frame(info['up']).T
    if 'face' in info:
        f = R @ minifig.unit(info['face'])
        R = minifig.rot_axis((0, 1, 0), np.arctan2(f[2], f[0])) @ R
    return R @ (np.array(point, float) - np.array(info['center'], float))


def boot_parts(boots):
    """A pair of boots (items.json wear "boots": the bands a leg is moulded in,
    minifig.booted), as parts: the legs' booted ends alone, and anything
    strapped under them (a snowshoe)."""
    parts = [{'part': minifig.booted(leg, boots['bands'], upper=False), 'color': 16} for leg in ('3816', '3817')]
    feet = boots.get('feet')
    if feet:   # (its pos is in the figure's frame: the legs hang from y = 44)
        x, y, z = feet['pos']
        parts += [{'part': feet['part'], 'color': feet.get('color', 16), 'pos': [sx * x, y - 44, z]} for sx in (1, -1)]
    return parts


SLASHEM = os.path.join(HERE, '..', 'vendor', 'SlashEM')
# an item named as the game names it ("ring of see invisible"): the client looks
# up a ring's tile by that name (brickitems.js), as a potion of see invisible
# goes by its own
PREFIX = {'ring': 'ring of ', 'wand': 'wand of ', 'spellbook': 'spellbook of ', 'scroll': 'scroll of '}
ART_TILE = 90000   # the game sends an artifact as ART_TILE + its number (port/winweb.c web_obj_tile)
VARIANT_TILE = 92000   # ...and a variant with a look of its own (holy water) as VARIANT_TILE + its number


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
        if n:   # (its base item by name: RIN_INVISIBILITY, a ring: "invisibility")
            arts[n] = (short, re.sub(r'^rin ', '', base.lower().replace('_', ' ')))
    return arts


def main():
    os.makedirs(OUT, exist_ok=True)
    colors = ldraw2glb.load_colors(ldraw2glb.LDRAW)
    lib = ldraw2glb.Library(ldraw2glb.LDRAW)
    built = {}
    arts = artifacts()
    classes = {}   # an object's name -> its classes (objclasses.py)
    for n, _, c in objclasses.objects(SLASHEM):
        classes.setdefault(n, set()).add(c)
    art_num = {name: n for n, (name, base) in arts.items()}
    for name, item in json.load(open(os.path.join(ASSETS, 'items.json'))).items():
        if 'parts' not in item and item.get('wear', {}).get('boots'):
            item = dict(item, parts=boot_parts(item['wear']['boots']))
        ldr = held_ldr(item)
        # an angel's glow round it (mist.js addAura): true, or {color, scale, tip: {fraction}}
        # (the tip's end: up as held, glTF +Y)
        aura = item.get('aura')
        if isinstance(aura, dict) and 'tip' in aura:
            aura = dict(aura, tip=dict({'dir': [0, 1, 0]}, **aura['tip']))
        extras = dict({'aura': aura} if aura else {}, **({'lightning': True} if item.get('lightning') else {}),
                      **({'fx': item['fx']} if item.get('fx') else {}), **({'hue': True} if item.get('hue') else {})) or None   # (its element in particles: mist.js addEffects)
        hinge = item.get('hinge')   # a part that swings on a hinge (a chest's lid): {joint, pivot, axis (LDraw), open (degrees)}
        if hinge:   # (in the model's units and axes, as ldraw2glb writes it: studs, Y up, Z to the front)
            hp = held_point(item, hinge['pivot'])
            extras = dict(extras or {}, hinge={'joint': hinge['joint'], 'pivot': [round(hp[0] / 20, 5), round(-hp[1] / 20, 5), round(-hp[2] / 20, 5)],
                                               'axis': [hinge['axis'][0], -hinge['axis'][1], -hinge['axis'][2]], 'open': hinge.get('open', 100)})
        if item.get('blink'):   # a part that blinks (a land mine's light): {joint} (mist.js addBlink)
            extras = dict(extras or {}, blink=item['blink'])
        glow = item.get('glow')   # its tip glowing: {"fraction": of its length from the tip, "color": a translucent one}
        if glow:   # (held, its tip is up: -Y)
            ldr = f"0 !BRICKHACK GLOW 0 -1 0 {glow['fraction']} {glow['color']}\n" + ldr
        prints = ''.join(str(os.path.getmtime(l.rsplit(' ', 1)[1])) for l in ldr.splitlines() if l.startswith('0 !TEXMAP'))
        key = hashlib.sha1((ldr + ldraw2glb.extra_stamp(ldr) + prints + json.dumps(extras)).encode()).hexdigest()[:12]   # (a hand-made part or a print changed: rebuild)
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        glb, src, keyfile = (os.path.join(OUT, slug + ext) for ext in ('.glb', '.ldr', '.key'))
        if not (os.path.exists(glb) and os.path.exists(keyfile) and open(keyfile).read() == key):
            open(src, 'w').write(ldr)
            geom = ldraw2glb.figure_geom(lib, src, ldr) if '!BRICKHACK GROUP' in ldr else ldraw2glb.glowing(lib.parse(src), ldr)   # (in joints: a node each)
            print(f'  {name}: {ldraw2glb.to_glb(geom, colors, 71, glb, extras)} tris')
            open(keyfile, 'w').write(key)
        built[name] = {'url': f'assets/brick/items/{slug}.glb?v={key}', 'brick': item.get('brick', '')}
        # its class (a potion, a ring...): a name can be more than one object (a potion and a ring
        # of see invisible); the client gives a tile only an item of its own class (tiles.json "classes")
        oc = item.get('class') or (next(iter(classes[name])) if len(classes.get(name, ())) == 1 else None)
        for cls, pre in PREFIX.items():   # "ring of conflict": a ring, whatever else is named conflict
            if name.startswith(pre) and cls in classes.get(name[len(pre):], ()):
                oc = cls
        if oc:
            built[name]['oc'] = oc
        elif len(classes.get(name, ())) > 1:
            print(f'  {name}: more than one object has this name ({", ".join(sorted(classes[name]))}): say which ("class")')
        if item.get('upright'):   # set down the right way up (food: a cheese, a pie), not on its side as a blade is
            built[name]['upright'] = True
        if item.get('wear'):   # worn on a minifig (a helm): the figure worker dresses the hero in it
            built[name]['wear'] = True
        if name in art_num:   # an artifact with a look of its own (the game sends it as this tile: winweb.c web_obj_tile)
            built[name]['vtile'] = ART_TILE + art_num[name]
        if item.get('variant'):   # a look for some of an item (holy water): the game sends it as this tile, its base item's sprite otherwise
            built[name]['vtile'] = VARIANT_TILE + item['variant']['n']
            built[name]['base'] = item['variant']['of']
    json.dump(built, open(os.path.join(ASSETS, 'items.built.json'), 'w'), indent=1)
    # every artifact, for the client: its tile, its name, its base item (shown when it has no look of its own)
    json.dump({str(ART_TILE + n): {'name': name, 'base': base} for n, (name, base) in sorted(arts.items())},
              open(os.path.join(ASSETS, 'artifacts.built.json'), 'w'), indent=1)
    print(f'artifacts: {len(arts)} ({sum(1 for _, (nm, _) in arts.items() if nm in built)} with a look of their own)')
    print(f'items: {len(built)}')


if __name__ == '__main__':
    main()

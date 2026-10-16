#!/usr/bin/env python3
"""SLASH'EM's objects, in order, from its src/objects.c: [(name, description,
class)], class one of weapon, armor, ring, amulet, tool, food, potion, scroll,
spellbook, wand, coin, gem, rock, ball, chain, venom.

The same name can be more than one object (a potion and a ring of see
invisible, a potion and a spellbook of healing): what an item is goes by its
class too (tiles2png.py writes each tile's; build_items.py each LEGO item's,
so the client matches a tile only with an item of its own class)."""
import re

MACROS = {
    'WEAPON': 'weapon', 'PROJECTILE': 'weapon', 'BOW': 'weapon', 'BULLET': 'weapon', 'GUN': 'weapon',
    'ARMOR': 'armor', 'HELM': 'armor', 'CLOAK': 'armor', 'SHIELD': 'armor', 'GLOVES': 'armor', 'BOOTS': 'armor', 'DRGN_ARMR': 'armor',
    'RING': 'ring', 'AMULET': 'amulet', 'TOOL': 'tool', 'CONTAINER': 'tool', 'WEPTOOL': 'tool', 'FOOD': 'food',
    'POTION': 'potion', 'SCROLL': 'scroll', 'SPELL': 'spellbook', 'WAND': 'wand', 'COIN': 'coin', 'GEM': 'gem', 'ROCK': 'gem',
}
ENTRY = re.compile(r'^\s*(' + '|'.join(list(MACROS) + ['OBJECT']) + r')\(\s*(?:OBJ\(\s*)?"([^"]+)"\s*,\s*(?:"([^"]*)"|[^,)]*)', re.M)


def objects(src):
    """[(name, description or None, class)] in objects.c's order (src: the SLASH'EM tree)."""
    text = open(f'{src}/src/objects.c', encoding='latin-1').read()
    out = []
    for m in ENTRY.finditer(text):
        macro, name, desc = m.group(1), m.group(2), m.group(3)
        if macro == 'OBJECT':
            c = re.search(r'([A-Z]+)_CLASS', text[m.end():m.end() + 400])
            cls = c.group(1).lower() if c else 'other'
            cls = {'spbook': 'spellbook', 'illobj': 'other'}.get(cls, cls)
        else:
            cls = MACROS[macro]
        out.append((name, desc or None, cls))
    return out


def tile_classes(src, names):
    """Each object tile's class: names as the tile file has them ('desc / name'
    or 'name'), in order; matched to objects.c's in order (an object a build
    leaves out has no tile: skipped; a spare description, among its class)."""
    objs = objects(src)
    out, i = [], 0
    for n in names:
        real = n.split(' / ')[-1]
        j = i
        while j < len(objs) and objs[j][0] != real:
            j += 1
        if j < len(objs):
            out.append(objs[j][2])
            i = j + 1
        else:   # a spare description with no object of its own (a scroll's FOOBIE BLETCH): its neighbours' class
            out.append(out[-1] if out else None)
    return out

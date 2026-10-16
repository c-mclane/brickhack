#!/usr/bin/env python3
"""Minifig customization: a roster figure with parts from the wardrobe swapped in.

web/assets/brick/wardrobe.json lists, per category (hat, hair, head, torso,
hands, pants, belt, cape, armor), options that each set some recipe keys
(tools/minifig.py). A choice {category: option id} replaces everything the
figure had in that category. What makes a race what it is stays: an angel's
wings, glow and marble, a doppelganger's mist, a quantum mechanic's flashing.

A character holds nothing of its own (empty_handed): what's in its hands is
what the game gives it to wield.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'web', 'assets', 'brick')
FIGS = os.path.join(ASSETS, 'figs')

# the recipe keys each category owns
KEYS = {
    'hat': ['hat', 'hatColor', 'hatDecal', 'plume'],
    'hair': ['hair'],
    'head': ['head', 'headColor', 'headRecolor'],
    'torso': ['torso', 'torsoColor', 'torsoDecal', 'torsoRecolor', 'armColor'],
    'hands': ['handColor'],
    'pants': ['legColor', 'legR', 'legL', 'dress', 'shortLegs'],
    'belt': ['hips', 'hipColor'],
}
CAPES = ('50231', '20551', '42450', '38301', '56630', '99464', '86038', '65384', 'u9490')   # neck items that are capes
HOODS = ('4505a', '24073')   # a cloak's hood or wrap (extras on the head): a helm takes them off
CROWNS = ('33322', '96491')   # tiaras (extras) go with the hat
# neck items that are body armour (breastplates, vests, shoulder pads): a suit put on takes their place
ARMOUR = ('2587', '22402', '78643', '93565', '15423', '85961', '3840', '30174', '89917', '30121', '15086', '11097',
          '11438', '12618', '15437', '15490', '35635', '37614', '41202', '7549', '86123', '88295')
TORSO = ('torso', 'torsoColor', 'torsoDecal', 'torsoRecolor', 'armColor')   # what a shirt or a printed suit replaces


def is_cape(item):
    return item['part'].startswith(CAPES)


def is_armour(item):
    return item['part'].startswith(ARMOUR)


def necklist(spec):
    neck = spec.get('neck') or []
    return list(neck if isinstance(neck, list) else [neck])


def empty_handed(spec):
    """A character's recipe with nothing in its hands: what it holds is what
    the game gives it (the weapon it wields), never the recipe's own."""
    return {k: v for k, v in spec.items() if k not in ('right', 'left')}


def wearing(spec, item):
    """A recipe with a worn item on (items.json "wear": recipe keys, as a
    helm's hat, hatColor, plume, extras; a shield's left; a cloak's neck,
    extras, dress; body armour's or a shirt's torso keys and neck armour;
    boots' bands; gloves' handColor). A helm takes the hair off (it would poke through) and
    whatever hat, plume or tiara the figure had; its extras go on beside the
    figure's own (an angel keeps its wings)."""
    wear = item.get('wear')
    if not wear:
        return spec
    if 'left' in wear:   # a shield, in the left hand
        return dict(spec, left=wear['left'])
    if item.get('slot') == 'gloves':   # the hands in the gloves' colour
        return dict(spec, **wear)
    if item.get('slot') == 'boots':   # the legs moulded with boots (minifig.booted), snowshoes under them
        return dict(spec, boots=wear['boots'])
    if item.get('slot') in ('suit', 'shirt'):   # body armour, or a shirt (items.json "slot")
        # a print on the torso (a shirt, mail, a robe's top) in place of the figure's own;
        # a suit's attachment on the neck (a breastplate, shoulder pads) in place of the
        # figure's armour (its cape, a beard, a quiver stay)
        if any(k in wear for k in TORSO):
            spec = {k: v for k, v in spec.items() if k not in TORSO}
            spec.update({k: wear[k] for k in TORSO if k in wear})
        if 'neck' in wear:
            spec['neck'] = [n for n in necklist(spec) if not is_armour(n)] + list(wear['neck'])
        if wear.get('dress'):   # a robe
            spec['dress'] = wear['dress']
        return spec
    if 'hat' not in wear:   # a cloak: its cape in place of the figure's (armour on the neck stays), a hood, an apron, a robe
        neck = spec.get('neck') or []
        neck = [n for n in (neck if isinstance(neck, list) else [neck]) if not is_cape(n)]
        spec = dict(spec, neck=neck + list(wear.get('neck', [])), extras=list(spec.get('extras', [])) + list(wear.get('extras', [])))
        if any(x['part'].startswith(HOODS) for x in wear.get('extras', [])):   # its hood up: the figure's own hat and hair off
            spec = {k: v for k, v in spec.items() if k not in ('hair', 'hat', 'hatColor', 'hatDecal', 'plume')}
        if wear.get('dress'):
            spec['dress'] = wear['dress']
        return spec
    # a helm: the hair off, the old hat, plume, tiara and any hood (a cloak's, put on first) too
    spec = {k: v for k, v in spec.items() if k not in ('hair', 'hat', 'hatColor', 'hatDecal', 'plume')}
    extras = [x for x in spec.get('extras', []) if not x['part'].startswith(CROWNS + HOODS)]
    spec.update({k: v for k, v in wear.items() if k != 'extras' and v is not None})
    spec['extras'] = extras + list(wear.get('extras', []))
    return spec


def stripped(spec, slot):
    """A recipe with its designed piece in a slot taken off (the starting gear
    that piece stood for, taken off): 'helm' its hat (the hair under it stays),
    'cloak' its cape (armour on the neck stays), 'shield' its shield, 'suit'
    its armour on the neck, 'boots' its boots."""
    if slot == 'helm':
        spec = {k: v for k, v in spec.items() if k not in ('hat', 'hatColor', 'hatDecal', 'plume')}
        return dict(spec, extras=[x for x in spec.get('extras', []) if not x['part'].startswith(CROWNS + HOODS)])
    if slot == 'cloak':
        neck = spec.get('neck') or []
        return dict(spec, neck=[n for n in (neck if isinstance(neck, list) else [neck]) if not is_cape(n)])
    if slot == 'shield':
        return {k: v for k, v in spec.items() if k != 'left'}
    if slot == 'boots':
        return {k: v for k, v in spec.items() if k != 'boots'}
    if slot == 'suit':   # its armour (the torso's print is the figure itself: it stays)
        return dict(spec, neck=[n for n in necklist(spec) if not is_armour(n)])
    return spec


def load_wardrobe():
    return json.load(open(os.path.join(ASSETS, 'wardrobe.json')))


def recipe(fig_id):
    """A roster figure's recipe, with its 'base' (if any) merged in."""
    spec = json.load(open(os.path.join(FIGS, fig_id + '.json')))
    if spec.get('base'):
        base = recipe(spec['base'])
        spec = {**base, **{k: v for k, v in spec.items() if k != 'base'}}
    return spec


def customize(spec, choices, wardrobe):
    """spec with the chosen options swapped in; unknown categories or options are ignored."""
    spec = dict(spec)
    neck = spec.get('neck') or []
    neck = list(neck if isinstance(neck, list) else [neck])
    for cat, opt_id in choices.items():
        opt = next((o for o in wardrobe['options'].get(cat, []) if o['id'] == opt_id), None)
        if opt is None:
            continue
        s = opt['set']
        if cat in ('cape', 'armor'):
            neck = [n for n in neck if is_cape(n) != (cat == 'cape')]
            if 'neck' in s:
                neck.append(s['neck'])
            continue
        for k in KEYS[cat]:
            spec.pop(k, None)
        if cat == 'hat':
            spec['extras'] = [x for x in spec.get('extras', []) if not x['part'].startswith(CROWNS)]
        if cat == 'pants' and 'hips' not in spec and not ('dress' in s or 'shortLegs' in s):
            spec['hips'], spec['hipColor'] = '3815', s.get('legColor', 1)   # legs need hips under them
        spec.update(s)
    spec['neck'] = neck
    return spec

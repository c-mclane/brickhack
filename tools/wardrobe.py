#!/usr/bin/env python3
"""Minifig customization: a roster figure with parts from the wardrobe swapped in.

web/assets/lego/wardrobe.json lists, per category (hat, hair, head, torso,
hands, pants, belt, cape, armor, gear), options that each set some recipe keys
(tools/minifig.py). A choice {category: option id} replaces everything the
figure had in that category. What makes a race what it is stays: an angel's
wings, glow and marble, a doppelganger's mist, a quantum mechanic's flashing.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
LEGO = os.path.join(HERE, '..', 'web', 'assets', 'lego')
FIGS = os.path.join(LEGO, 'figs')

# the recipe keys each category owns
KEYS = {
    'hat': ['hat', 'hatColor', 'hatDecal', 'plume'],
    'hair': ['hair'],
    'head': ['head', 'headColor', 'headRecolor'],
    'torso': ['torso', 'torsoColor', 'torsoDecal', 'torsoRecolor', 'armColor'],
    'hands': ['handColor'],
    'pants': ['legColor', 'legR', 'legL', 'dress', 'shortLegs'],
    'belt': ['hips', 'hipColor'],
    'gear': ['right', 'left'],
}
CAPES = ('50231', '20551', '42450', '38301', '56630', '99464', '86038', '65384')   # neck items that are capes
CROWNS = ('33322', '96491')   # tiaras (extras) go with the hat


def is_cape(item):
    return item['part'].startswith(CAPES)


def load_wardrobe():
    return json.load(open(os.path.join(LEGO, 'wardrobe.json')))


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

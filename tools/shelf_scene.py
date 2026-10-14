#!/usr/bin/env python3
"""Lay out the character-select shelf: a LEGO display case with four
minifigs per shelf, as many shelves as the roster needs (first row on top).

  shelf_scene.py              # writes web/assets/lego/scene.json, then run build_scene.py

The roster is web/assets/lego/roster.json: a list of figure names (figs/<name>.json).
"""
import json, os

LEGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'lego')
PER_SHELF = 4
FRAME, WALL = 70, 28          # reddish brown frame and boards, dark tan back wall
TIER = 6 * 24                 # six bricks of headroom per shelf (room for a plume)
FEET = 72                     # a minifig's feet are 72 LDU below its neck origin


def main():
    roster = json.load(open(os.path.join(LEGO, 'roster.json')))
    # figures of other roles stand on the floor in front of the shelf, the knights' display case
    front = [n for n in roster if json.load(open(os.path.join(LEGO, 'figs', n + '.json'))).get('role', 'knight') != 'knight']
    roster = [n for n in roster if n not in front]
    shelves = [roster[i:i + PER_SHELF] for i in range(0, len(roster), PER_SHELF)]
    n = len(shelves)
    objs = [{'part': '3811', 'color': 2, 'pos': [0, 0, 0]}]                # floor baseplate
    # board k sits on the back wall of tier k-1; board n is the roof
    tops = [-8 - k * (TIER + 8) for k in range(n + 1)]
    for y in tops:
        objs.append({'part': '92438', 'color': FRAME, 'pos': [0, y, 0]})  # 8x16 plate shelf board
    for y in tops[:-1]:
        for k in range(1, TIER // 24 + 1):                                # back wall: 1x16 bricks, last stud row
            objs.append({'part': '2465', 'color': WALL, 'pos': [0, y - 24 * k, 70]})
    for k in range(1, -tops[-1] // 24 + 1):                               # side columns: 1x8 bricks, front to back
        for x in (-170, 170):
            objs.append({'part': '3008', 'color': FRAME, 'pos': [x, -24 * k, 0], 'rotY': 90})
    # top shelf gets the first row; figures stand a stud back so swords just overhang
    for row, y in zip(shelves, reversed(tops[:-1])):
        for i, fig in enumerate(row):
            objs.append({'fig': fig, 'pos': [-120 + 80 * i, y - FEET, -10]})
    for i, fig in enumerate(front):   # on the baseplate, a few studs in front of the case
        objs.append({'fig': fig, 'pos': [-40 * (len(front) - 1) + 80 * i, -FEET, -200]})
    mid = -tops[-1] / 2 / 20
    scene = {'camera': {'pos': [0, mid + 1, 22 + 9 * n], 'target': [0, mid, 0]}, 'objects': objs}
    json.dump(scene, open(os.path.join(LEGO, 'scene.json'), 'w'), indent=1)
    print(f'{len(roster)} figures on {n} shelves, {len(objs)} objects')


if __name__ == '__main__':
    main()

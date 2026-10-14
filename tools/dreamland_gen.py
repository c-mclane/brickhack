#!/usr/bin/env python3
"""Generate Ascend's first level (the "dreamland" option, level dreamlnd).

An open grass plain (flowers, a few shrubs and rocks) ringed by dense woods
(big trees and fallen logs) of varying thickness (a soldier ant waits inside the tower).  You start in a little wood house on the plain (fireplace,
chimney, sloped roof); your horse waits in a fenced paddock beside it.  A
stone castle tower stands in a clearing in the woods, a little path leading
out to it.  No monsters: just the hero.  Writes from one plan, so the game
and the 3D client agree:
  <des>   SLASH'EM special level: the plain, the trees, the stairs
  <json>  the client's layout for the same map: the house, the paddock, the
          tower and the path (all in map coordinates; see web/js/dreamscape.js)
  <.h>    (optional) for the window port, in the game's coordinates: the
          paddock's middle square (where your horse starts), the stair in
          the house (going down it leaves the game) and the portal on the
          tower roof (the way on to the next level)

Also writes, next to <out.des>, Dreamland's higher levels:
  dreamland2.des  level 2, reached through the tower's portal: a forest glade.
                  Woods fill the map (big trees, a wall of weeds, fallen logs:
                  client), a path carved through them from where you arrive,
                  glades off it, fenced meadows, a few easy monsters, and at
                  the far end a clearing with a ring of standing stones round
                  the portal on.
  dreamland3.des  level 3: an 8x8 platform floating in the open sky, a star
                  block in each corner (client), two Waddle Dees.  Fall off
                  and you're put back; kill both Waddle Dees and a portal
                  opens in the middle.
  dreamland4.des  level 4: a Kirby-style grass field ringed by woods (pillars,
                  checkered towers, sky platforms, ladders, star-block walls
                  with bomb blocks, a wall of weeds round it: built by the
                  client), one of each Kirby enemy, food lying about, the
                  portal hidden in a checkered tower.
  dreamland5.des  level 5: a white marble palace in formal gardens (temple,
                  wings, porches, hedge mazes, flowers: built by the client),
                  fountains, pools, the altar ringed by water, cherubs and
                  lesser garden creatures; offering anything on the altar
                  opens a portal in one of the hedge mazes.
  dreamland6.des  level 6: the Fountain of Dreams, a round island floating in
                  the night sky: a quartz fountain (the Star Rod on top) in a
                  ring pool, iridescent waterfalls, lavender towers, Kirby;
                  the trial (Kirby, Waddle Doos, a cherub, Kirby again) and
                  then a portal.
  dreamland7.des  level 7: level 5's palace and gardens again, at night under
                  the stars, full of NetHack monsters to fight (ordinary,
                  harder and strange ones): a chance to level up.

The levels' numbers are written to <out.h> too (DREAM_LV_GLADE...), for the
engine; the client has the same table (web/js/dreamscape.js DL).

usage: dreamland_gen.py <out.des> <out.json> [<out.h>]
"""
import json
import math
import random
import sys

W, H = 118, 62  # map size (SLASH'EM MAP_X_LIM/MAP_Y_LIM)
rng = random.Random(1992)  # fixed: the same level every build

HOUSE = {"x": 50, "y": 27, "w": 7, "d": 5}  # the little wood house on the plain
HOUSE_DOOR = (HOUSE["x"] + 3, HOUSE["y"] + HOUSE["d"] - 1)  # middle of its south wall
UPSTAIR = (HOUSE["x"] + 3, HOUSE["y"] + 2)  # where you start: inside the house
PEN = {"x": 59, "y": 27, "w": 7, "d": 6}  # the horse's paddock (no gate: break the log panel to let it out)
TOWER = {"x": 99, "y": 5, "w": 7, "d": 7, "h": 16}  # tall stone tower in the north-east woods
TOWER_DOOR = (TOWER["x"] + TOWER["w"] // 2, TOWER["y"] + TOWER["d"] - 1)  # middle of its south wall
# no stairs on to the next level: a magic portal stands on top of the tower
PORTAL = (TOWER["x"] + TOWER["w"] // 2, TOWER["y"] + TOWER["d"] // 2)  # the middle of its roof


def wavy(n, lo, hi, seed):
    """n thicknesses between lo and hi that rise and fall smoothly"""
    r = random.Random(seed)
    waves = [(r.uniform(0.04, 0.09), r.uniform(0, 6.3), 1.0), (r.uniform(0.12, 0.25), r.uniform(0, 6.3), 0.45),
             (r.uniform(0.3, 0.5), r.uniform(0, 6.3), 0.2)]
    out = []
    for i in range(n):
        v = sum(a * math.sin(i * f + p) for f, p, a in waves) / 1.65  # about -1..1
        out.append(round(lo + (hi - lo) * (0.5 + 0.5 * v)))
    return out


# ---- the woods: a ring of trees, thin in places and deep in others --------
grid = [['.'] * W for _ in range(H)]
north, south = wavy(W, 4, 15, 1), wavy(W, 4, 14, 2)
west, east = wavy(H, 4, 17, 3), wavy(H, 4, 15, 4)
# deep woods round the tower in the north-east corner, thickening gradually
def ramp(i, a, b):  # 0 before a, rising smoothly to 1 at b
    k = min(1.0, max(0.0, (i - a) / (b - a)))
    return k * k * (3 - 2 * k)
for x in range(W):
    north[x] = max(north[x], round(19 * ramp(x, 66, 92)))
for y in range(H):
    east[y] = max(east[y], round(25 * (1 - ramp(y, 14, 34))))
for y in range(H):
    for x in range(W):
        if y < north[x] or y >= H - south[x] or x < west[y] or x >= W - east[y]:
            grid[y][x] = 'T'
# ragged edges: a few lone trees and little clumps just out from the woods
for _ in range(70):
    x, y = rng.randrange(W), rng.randrange(H)
    edge = min(y - north[x], H - 1 - south[x] - y, x - west[y], W - 1 - east[y] - x)
    if 0 <= edge <= 3 and grid[y][x] == '.':
        for dx, dy in [(0, 0)] + rng.sample([(1, 0), (-1, 0), (0, 1), (0, -1)], rng.randint(0, 2)):
            if 0 <= x + dx < W and 0 <= y + dy < H:
                grid[y + dy][x + dx] = 'T'

# ---- the tower's clearing and the path out of the woods -------------------
tx, ty, tw, td = TOWER["x"], TOWER["y"], TOWER["w"], TOWER["d"]
for y in range(ty - 2, ty + td + 2):
    for x in range(tx - 2, tx + tw + 2):
        grid[y][x] = '.'
path = []
px, py = TOWER_DOOR[0], TOWER_DOOR[1] + 1
while True:
    for x in (px, px + 1):  # two squares wide
        grid[py][x] = '.'
        path.append([x, py])
    py += 1
    if py >= H - 1 or (grid[py][px] == '.' and grid[py][px + 1] == '.' and py > ty + td + 4):
        break
    px = max(tx - 12, min(W - 4, px + rng.choice([-1, 0, 0, 0, 1])))  # wander a little
# and on across the plain to the house's front door: south of the paddock,
# wandering gently, then up to the door
def stamp(x, y):  # two squares wide
    for xx, yy in ((x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)):
        if [xx, yy] not in path:
            grid[yy][xx] = '.'
            path.append([xx, yy])
ROAD_Y = PEN["y"] + PEN["d"] + 2  # the row it runs along, clear of the paddock
door_x = HOUSE_DOOR[0] - 1
step = 1 if ROAD_Y > py else -1
for y in range(py, ROAD_Y, step):
    stamp(px, y)
phase = rng.uniform(0, 6.3)
prev = ROAD_Y
for x in range(px, door_x - 1, -1):
    y = ROAD_Y + round(1.3 * math.sin(x * 0.18 + phase) * min(1, (x - door_x) / 6, (px - x) / 6))
    for yy in range(min(prev, y), max(prev, y) + 1):
        stamp(x, yy)
    prev = y
for y in range(prev, HOUSE_DOOR[1], -1):
    stamp(door_x, y)
# ---- a few shrubs dotted over the plain (tree squares the client draws with
# the game's own little tree tile): sparse, just for fun, and a few in the
# house's yard ---------------------------------------------------------------
def clear_of(x, y, box, margin):
    return not (box["x"] - margin <= x < box["x"] + box["w"] + margin and box["y"] - margin <= y < box["y"] + box["d"] + margin)
on_path = {(x, y) for x, y in path}
placed = 0
shrubs = []
for _ in range(2000):
    if placed >= 14:
        break
    x, y = rng.randrange(W), rng.randrange(H)
    if grid[y][x] != '.' or not clear_of(x, y, HOUSE, 4) or not clear_of(x, y, PEN, 3):
        continue
    if any(abs(x - px) + abs(y - py) < 3 for px, py in on_path):
        continue
    edge = min(y - north[x], H - 1 - south[x] - y, x - west[y], W - 1 - east[y] - x)
    if edge < 5:
        continue  # out in the open, not hugging the woods
    placed += 1
    for dx, dy in [(0, 0)] + rng.sample([(1, 0), (-1, 0), (0, 1), (0, -1)], rng.choice([0, 0, 0, 1])):
        grid[y + dy][x + dx] = 'T'
        shrubs.append([x + dx, y + dy])
# the yard: by the house's corners and either side of the path to its door
hx0, hy0, hx1, hy1 = HOUSE["x"], HOUSE["y"], HOUSE["x"] + HOUSE["w"] - 1, HOUSE["y"] + HOUSE["d"] - 1
for x, y in ((hx0 - 1, hy1 + 1), (hx1 + 1, hy1 + 2), (hx0 + 1, hy1 + 2), (hx1 + 1, hy0 - 1), (hx0 - 2, hy0)):
    if grid[y][x] == '.' and (x, y) not in on_path and (x, y) != HOUSE_DOOR and clear_of(x, y, PEN, 1):
        grid[y][x] = 'T'
        shrubs.append([x, y])

grid[UPSTAIR[1]][UPSTAIR[0]] = '.'

# ---- a secret: a hidden glade where the west woods are deepest -------------
# A path of "trees" you can walk through (the client draws trees on them)
# runs west from the edge of the woods to a tiny glade, where a blessed +7
# Grayswandir lies waiting.
def woods_depth(row):  # how deep the west woods are on a row (99: no way through to the plain)
    d = 0
    while d < W // 3 and grid[row][d] == 'T':
        d += 1
    return d if d < W // 3 else 99
rows_ok = [r for r in range(6, H - 6) if woods_depth(r) < 99]
sz = max(rows_ok, key=lambda r: min(woods_depth(r - 1), woods_depth(r), woods_depth(r + 1)))
secret_path = []
x = W // 2
while grid[sz][x - 1] == '.':
    x -= 1  # the woods' edge on that row
for xx in range(x - 1, 4, -1):  # through the trees, almost to the map's edge
    if grid[sz][xx] == 'T':
        grid[sz][xx] = '.'
        secret_path.append([xx, sz])
glade = [[gx, gy] for gy in range(sz - 1, sz + 2) for gx in range(2, 5)]
for gx, gy in glade:
    grid[gy][gx] = '.'
SWORD = (3, sz)

# ---- the woods: Minecraft trees and fallen logs (built by the client) ------
# Big trees packed close all through the woods (and one beside the house);
# between them a solid wall of tall weeds and grass, two blocks high, with a
# fallen log here and there.  No flat tree tiles show in the woods.  The
# secret path runs through weeds you can walk right through.
from collections import deque
depth = [[0 if grid[y][x] == '.' else -1 for x in range(W)] for y in range(H)]
q = deque((x, y) for y in range(H) for x in range(W) if depth[y][x] == 0)
while q:
    x, y = q.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        xx, yy = x + dx, y + dy
        if 0 <= xx < W and 0 <= yy < H and depth[yy][xx] < 0:
            depth[yy][xx] = depth[y][x] + 1
            q.append((xx, yy))
orng = random.Random(4)
oaks = [{"x": HOUSE["x"] - 4, "y": HOUSE["y"] + 3, "h": 5}]  # the one by the house
grid[oaks[0]["y"]][oaks[0]["x"]] = 'T'  # (it stands on a tree square like the rest)
shrub_set = {(x, y) for x, y in shrubs}
woods = [(x, y) for y in range(H) for x in range(W) if grid[y][x] == 'T' and (x, y) not in shrub_set]
orng.shuffle(woods)
trunks = {(oaks[0]["x"], oaks[0]["y"])}
for x, y in woods:
    if not clear_of(x, y, {"x": tx, "y": ty, "w": tw, "d": td}, 3):
        continue  # keep the tower's clearing clear
    if any((x + dx, y + dy) in trunks for dx in (-1, 0, 1) for dy in (-1, 0, 1)) or orng.random() > 0.8:
        continue  # trunks close, but never touching
    trunks.add((x, y))
    oaks.append({"x": x, "y": y, "h": orng.randint(4, 7)})
# a fallen log now and then (two blocks long where there's room, sometimes
# one on another); weeds everywhere else
logs, weeds, taken = [], [], set(trunks)
woods_set = set(woods)
for x, y in sorted(woods, key=lambda c: orng.random()):
    if (x, y) in taken or orng.random() > 0.07:
        continue
    for axis, (dx, dy) in orng.sample([("x", (1, 0)), ("z", (0, 1))], 2):
        if (x + dx, y + dy) in woods_set and (x + dx, y + dy) not in taken:
            run = [(x, y), (x + dx, y + dy)]
            break
    else:
        axis, run = orng.choice("xz"), [(x, y)]
    stack = 2 if orng.random() < 0.15 else 1
    for cx, cy in run:
        logs.append([cx, cy, axis, stack])
        taken.add((cx, cy))
weeds = [[x, y] for x, y in sorted(woods) if (x, y) not in taken]

# ---- flowers all over the grass, and a few rocks ---------------------------
def built(x, y, margin=0):
    return (not clear_of(x, y, HOUSE, margin) or not clear_of(x, y, PEN, margin)
            or not clear_of(x, y, {"x": tx, "y": ty, "w": tw, "d": td}, margin))
on_path = {(x, y) for x, y in path}
rocks = []
for _ in range(400):
    if len(rocks) >= 7:
        break
    x, y = rng.randrange(W), rng.randrange(H)
    if grid[y][x] != '.' or built(x, y, 4) or any(abs(x - a) + abs(y - b) < 3 for a, b in on_path):
        continue
    if any(abs(x - r[0]) + abs(y - r[1]) < 12 for r in rocks) or abs(x - UPSTAIR[0]) + abs(y - UPSTAIR[1]) < 6:
        continue
    clump = [(x, y)] + rng.sample([(x + 1, y), (x, y + 1), (x - 1, y), (x + 1, y + 1)], rng.choice([0, 1, 2]))
    if all(grid[b][a] == '.' and (a, b) not in on_path for a, b in clump):
        for i, (a, b) in enumerate(clump):
            rocks.append([a, b, 2 if i == 0 and len(clump) > 1 and rng.random() < 0.5 else 1])
rock_set = {(x, y) for x, y, _ in rocks}
secret_set = {(x, y) for x, y in secret_path} | {(x, y) for x, y in glade}
flowers = [[x, y, rng.randrange(3)] for y in range(H) for x in range(W)
           if grid[y][x] == '.' and (x, y) not in on_path and (x, y) not in rock_set and (x, y) not in secret_set
           and not built(x, y) and rng.random() < 0.16]

# the house's front door: a real door, closed but not locked
grid[HOUSE_DOOR[1]][HOUSE_DOOR[0]] = '+'

# ---- write the level ------------------------------------------------------
des = [
    "# MineHack Ascend, level 1 (generated by tools/dreamland_gen.py)",
    'MAZE:"dreamlnd",\' \'',
    "GEOMETRY:center,center",
    "MAP",
    *("".join(row) for row in grid),
    "ENDMAP",
    f"REGION:(0,0,{W - 1},{H - 1}),lit,\"ordinary\"",
    f"NON_DIGGABLE:(0,0,{W - 1},{H - 1})",
    # level 1 has no up stairs of its own: the dungeon's exit (where you
    # start) is the branch, so pin it to the middle of the plain
    f"BRANCH:({UPSTAIR[0]},{UPSTAIR[1]},{UPSTAIR[0]},{UPSTAIR[1]}),(0,0,0,0)",
    # (no down stairs: the way on is the portal on the tower roof)
    # a soldier ant guards the tower's ground floor
    f"MONSTER:'a',\"soldier ant\",({TOWER['x'] + 3},{TOWER['y'] + 3}),hostile",
    f"OBJECT:')',\"silver saber\",({SWORD[0]},{SWORD[1]}),blessed,7,\"Grayswandir\"",  # the secret
    f"DOOR:closed,({HOUSE_DOOR[0]},{HOUSE_DOOR[1]})",
]
open(sys.argv[1], "w").write("\n".join(des) + "\n")

layout = {
    "size": [W, H], "upstair": UPSTAIR,
    "house": {**HOUSE, "door": HOUSE_DOOR}, "pen": PEN,
    "tower": {**TOWER, "door": TOWER_DOOR, "portal": PORTAL}, "path": path, "oaks": oaks,
    "secret": {"path": secret_path, "glade": glade},
    "logs": logs, "weeds": weeds, "shrubs": shrubs, "rocks": rocks, "flowers": flowers,
}
json.dump(layout, open(sys.argv[2], "w"), indent=1)
if len(sys.argv) > 3:
    # the game's squares are the map's + (1, 1) (the map sits inside the border column/row)
    open(sys.argv[3], "w").write(
        "/* generated by tools/dreamland_gen.py: places on Ascend's first level */\n"
        "/* where the hero's horse starts */\n"
        f"#define DREAM_PEN_X {PEN['x'] + PEN['w'] // 2 + 1}\n#define DREAM_PEN_Y {PEN['y'] + PEN['d'] // 2 + 1}\n"
        "/* the house's front door (in its south wall) */\n"
        f"#define DREAM_DOOR_X {HOUSE_DOOR[0] + 1}\n#define DREAM_DOOR_Y {HOUSE_DOOR[1] + 1}\n"
        "/* the stair in the house, where you start: going down it leaves the game */\n"
        f"#define DREAM_EXIT_X {UPSTAIR[0] + 1}\n#define DREAM_EXIT_Y {UPSTAIR[1] + 1}\n"
        "/* the portal on the tower roof (and the roof's height): the way on to the next level */\n"
        f"#define DREAM_PORTAL_X {PORTAL[0] + 1}\n#define DREAM_PORTAL_Y {PORTAL[1] + 1}\n#define DREAM_PORTAL_Z {TOWER['h']}\n")
trees = sum(row.count('T') for row in grid)
print(f"ascend level 1: {trees} tree squares ({len(oaks)} Minecraft trees, {len(logs)} logs, {len(weeds)} squares of weeds, {len(shrubs)} shrubs), "
      f"{len(flowers)} flowers, {len(rocks)} rock blocks, path {len(path)} squares")

# ---- Dreamland's second level: a forest glade -------------------------------
# Like the woods round level 1, but filling the whole map (big trees, a wall of
# weeds, fallen logs: the client builds them), with a path carved through
# from where you arrive, in the south, to a clearing in the north where a ring
# of standing stones stands round the portal on.  Glades open off the path,
# NetHack-overland style: a pond, two fenced meadows (each with a log panel
# you can break to get in), an open meadow.  Only a few easy monsters: it's
# the level to find your feet and level up a little.
import os
G = [['T'] * W for _ in range(H)]
rg = random.Random(2002)
ARRIVE2 = (W // 2, H - 6)
HENGE = (W // 2 + 6, 11)  # the clearing's middle: the portal
path2 = []
path2_set = set()
def g_open(x, y, ch='.'):
    if 1 <= x < W - 1 and 1 <= y < H - 1:
        G[y][x] = ch
def g_path(x, y, r):
    for yy in range(y - r, y + r + 1):
        for xx in range(x - r, x + r + 1):
            if 1 <= xx < W - 1 and 1 <= yy < H - 1 and G[yy][xx] != 'P':
                G[yy][xx] = '.'
                if (xx, yy) not in path2_set:
                    path2_set.add((xx, yy))
                    path2.append([xx, yy])
def trail(a, b, r):
    """a path from a to b, wandering a little either side of the straight line"""
    (x0, y0), (x1, y1) = a, b
    n = 2 * max(abs(x1 - x0), abs(y1 - y0), 1)
    ph, amp = rg.uniform(0, 6.3), rg.uniform(1.5, 3.0)
    l = math.hypot(x1 - x0, y1 - y0) or 1
    nx, ny = -(y1 - y0) / l, (x1 - x0) / l
    for i in range(n + 1):
        t = i / n
        w = amp * math.sin(t * math.pi) * math.sin(t * 6 + ph)
        g_path(round(x0 + (x1 - x0) * t + nx * w), round(y0 + (y1 - y0) * t + ny * w), r)
def ellipse(cx, cy, rx, ry, ragged=0.15):
    cells = []
    for y in range(cy - ry - 1, cy + ry + 2):
        for x in range(cx - rx - 1, cx + rx + 2):
            if 1 <= x < W - 1 and 1 <= y < H - 1 and ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 + rg.uniform(-ragged, ragged):
                cells.append((x, y))
    return cells
# where you arrive: a little clearing at the south end
for x, y in ellipse(ARRIVE2[0], ARRIVE2[1], 4, 3):
    g_open(x, y)
# the clearing at the north end, round the standing stones
for x, y in ellipse(HENGE[0], HENGE[1], 11, 9, 0.08):
    g_open(x, y)
# the main path, north through the woods
WAY = [ARRIVE2, (40, 46), (70, 37), (46, 27), (66, 19), HENGE]
for a, b in zip(WAY, WAY[1:]):
    trail(a, b, 1)
# the glades off it: (middle, half-width, half-height, kind, the path point it opens off)
GLADES = [((22, 50), 9, 5, "pond", WAY[1]), ((92, 46), 9, 5, "fenced", WAY[2]),
          ((20, 28), 8, 5, "fenced", WAY[3]), ((94, 22), 8, 5, "meadow", WAY[4])]
fences2, panels2, glade_cells = [], [], {}
for (cx, cy), rx, ry, kind, via in GLADES:
    cells = ellipse(cx, cy, rx, ry)
    glade_cells[(cx, cy)] = cells
    for x, y in cells:
        g_open(x, y)
    trail(via, (cx, cy), 0)  # a narrower side path in
    if kind == "pond":
        for x, y in ellipse(cx - 2, cy, 4, 2, 0.1):
            G[y][x] = 'P'
    if kind == "fenced":
        # a fenced paddock inside the glade; where the side path crosses the
        # fence, a panel of logs you can break
        x0, x1, y0, y1 = cx - rx + 3, cx + rx - 3, cy - ry + 2, cy + ry - 2
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if (x in (x0, x1) or y in (y0, y1)) and G[y][x] == '.':
                    (panels2 if (x, y) in path2_set else fences2).append([x, y])
fence_set = {(x, y) for x, y in fences2} | {(x, y) for x, y in panels2}
# the standing stones: an outer ring of trilithons (two uprights and a lintel
# across), a gap where the path comes in from the south; inside, a horseshoe
# of taller ones opening towards it
henge2 = []  # [x, height, z]
henge_cells = set()
def stone(x, z, top):
    for y in range(top):
        henge2.append([x, y, z])
    henge_cells.add((x, z))
for k in range(12):
    deg = k * 30 + 4
    if deg + 22 >= 240 and deg <= 300:
        continue  # the way in, from the south
    arc = []
    for da in (0, 11, 22):
        a = math.radians(deg + da)
        c = (round(HENGE[0] + 6.5 * math.cos(a)), round(HENGE[1] - 6.5 * math.sin(a)))
        if c not in arc:
            arc.append(c)
    stone(*arc[0], 3)
    stone(*arc[-1], 3)
    for x, z in arc:
        henge2.append([x, 3, z])  # the lintel
for deg in (30, 60, 90, 120, 150):
    a = math.radians(deg)
    mx, mz = HENGE[0] + 3.4 * math.cos(a), HENGE[1] - 3.4 * math.sin(a)
    tx, tz = -math.sin(a), -math.cos(a)  # along the ring
    ends = [(round(mx + tx), round(mz + tz)), (round(mx - tx), round(mz - tz))]
    for x, z in ends:
        stone(x, z, 4)
    for x, z in set(ends + [(round(mx), round(mz))]):
        henge2.append([x, 4, z])
# the woods: Minecraft trees close together near anything open, further
# apart deep in; weeds round them near the open (deeper in, under the
# canopy, you can't see the ground anyway); a fallen log now and then
depth2 = [[0 if G[y][x] != 'T' else -1 for x in range(W)] for y in range(H)]
q2 = deque((x, y) for y in range(H) for x in range(W) if depth2[y][x] == 0)
while q2:
    x, y = q2.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        xx, yy = x + dx, y + dy
        if 0 <= xx < W and 0 <= yy < H and depth2[yy][xx] < 0:
            depth2[yy][xx] = depth2[y][x] + 1
            q2.append((xx, yy))
woods2 = [(x, y) for y in range(H) for x in range(W) if G[y][x] == 'T']
rg.shuffle(woods2)
oaks2, trunks2 = [], set()
for x, y in woods2:
    near = depth2[y][x] <= 3
    gap = 1 if near else 2
    if any((x + dx, y + dy) in trunks2 for dx in range(-gap, gap + 1) for dy in range(-gap, gap + 1)):
        continue
    if rg.random() > (0.8 if near else 0.45):
        continue
    trunks2.add((x, y))
    oaks2.append({"x": x, "y": y, "h": rg.randint(4, 7 if near else 8)})
logs2, taken2 = [], set(trunks2)
for x, y in woods2:
    if (x, y) in taken2 or depth2[y][x] > 4 or rg.random() > 0.06:
        continue
    logs2.append([x, y, rg.choice("xz"), 2 if rg.random() < 0.15 else 1])
    taken2.add((x, y))
weeds2 = [[x, y] for x, y in sorted(woods2) if (x, y) not in taken2 and depth2[y][x] <= 3]
# flowers over the open grass
flowers2 = [[x, y, rg.randrange(3)] for y in range(H) for x in range(W)
            if G[y][x] == '.' and (x, y) not in path2_set and (x, y) not in fence_set
            and (x, y) not in henge_cells and rg.random() < 0.15]
# who lives here
def spots_in(cells):
    return [c for c in cells if G[c[1]][c[0]] == '.' and c not in fence_set and c not in henge_cells]
def inside_fence(cx, cy, rx, ry):
    return [(x, y) for y in range(cy - ry + 3, cy + ry - 2) for x in range(cx - rx + 4, cx + rx - 3) if G[y][x] == '.']
mons2 = []
def put(cls, name, cells, n):
    cells = sorted(cells)
    rg.shuffle(cells)
    for x, y in cells[:n]:
        mons2.append((cls, name, x, y))
(pc, _, _, _, _), (fa, farx, fary, _, _), _, (mc, _, _, _, _) = GLADES
# just a few easy ones: the level to find your feet and get a few kills in
put('u', "pony", inside_fence(fa[0], fa[1], farx, fary), 1)  # in one of the fenced meadows
far_path = sorted(c for c in path2_set if c[1] < H - 14)
put('d', "jackal", far_path, 1)
put('r', "giant rat", far_path, 1)
put('d', "coyote", spots_in(glade_cells[pc]), 1)  # by the pond
put('d', "fox", spots_in(glade_cells[mc]), 1)  # in the open meadow
des2 = [
    "# MineHack Ascend: Dreamland, level 2, a forest glade (generated by tools/dreamland_gen.py)",
    'MAZE:"dreamln2",\' \'',
    "GEOMETRY:center,center",
    "MAP",
    *("".join(row) for row in G),
    "ENDMAP",
    f"REGION:(0,0,{W - 1},{H - 1}),lit,\"ordinary\"",
    f"NON_DIGGABLE:(0,0,{W - 1},{H - 1})",
    f"TELEPORT_REGION:({ARRIVE2[0] - 1},{ARRIVE2[1] - 1},{ARRIVE2[0] + 1},{ARRIVE2[1] + 1}),(0,0,0,0)",
    *(f"MONSTER:'{c}',\"{n}\",({x},{y}),hostile" for c, n, x, y in mons2),
]
open(os.path.join(os.path.dirname(sys.argv[1]) or ".", "dreamland2.des"), "w").write("\n".join(des2) + "\n")
layout["glade"] = {"oaks": oaks2, "logs": logs2, "weeds": weeds2, "path": path2, "fences": fences2, "panels": panels2,
                   "henge": henge2, "flowers": flowers2, "portal": list(HENGE)}
json.dump(layout, open(sys.argv[2], "w"), indent=1)
if len(sys.argv) > 3:
    open(sys.argv[3], "a").write(
        "/* Dreamland's levels, by number (the client has the same table: web/js/dreamscape.js DL) */\n"
        "#define DREAM_LV_GLADE 2\n#define DREAM_LV_SKY 3\n#define DREAM_LV_KIRBY 4\n#define DREAM_LV_PALACE 5\n"
        "#define DREAM_LV_FOUNTAIN 6\n#define DREAM_LV_BATTLE 7\n#define DREAM_LEVELS 7\n"
        "/* the forest glade: the portal in the middle of the standing stones */\n"
        f"#define DREAM_GLADE_PORTAL_X {HENGE[0] + 1}\n#define DREAM_GLADE_PORTAL_Y {HENGE[1] + 1}\n")
print(f"dreamland level 2: a forest glade, {len(oaks2)} Minecraft trees, {len(weeds2)} squares of weeds, {len(logs2)} logs, "
      f"path {len(path2)} squares, {len(fences2)} fence squares, {len(henge2)} standing-stone blocks, {len(mons2)} monsters")

# ---- Dreamland's third level: a little platform in the sky ---------------
PLAT = {"x": W // 2 - 4, "y": H // 2 - 4, "w": 8, "d": 8}
g2 = [['A'] * W for _ in range(H)]  # open air all round
for y in range(PLAT["y"], PLAT["y"] + PLAT["d"]):
    for x in range(PLAT["x"], PLAT["x"] + PLAT["w"]):
        g2[y][x] = '.'
px0, py0, px1, py1 = PLAT["x"], PLAT["y"], PLAT["x"] + PLAT["w"] - 1, PLAT["y"] + PLAT["d"] - 1
des2 = [
    "# MineHack Ascend: Dreamland, level 3 (generated by tools/dreamland_gen.py)",
    'MAZE:"dreamln3",\' \'',
    "GEOMETRY:center,center",
    "MAP",
    *("".join(row) for row in g2),
    "ENDMAP",
    f"REGION:(0,0,{W - 1},{H - 1}),lit,\"ordinary\"",
    f"NON_DIGGABLE:(0,0,{W - 1},{H - 1})",
    # you come up through the portal onto the platform (not on its corners)
    f"TELEPORT_REGION:({px0 + 1},{py0 + 1},{px1 - 1},{py1 - 1}),(0,0,0,0)",
    f"MONSTER:'Y',\"Waddle Dee\",({px0 + 2},{py0 + 5})",
    f"MONSTER:'Y',\"Waddle Dee\",({px1 - 2},{py0 + 2})",
]
open(os.path.join(os.path.dirname(sys.argv[1]) or ".", "dreamland3.des"), "w").write("\n".join(des2) + "\n")
PORTAL2 = (PLAT["x"] + PLAT["w"] // 2, PLAT["y"] + PLAT["d"] // 2)  # opens once both Waddle Dees are gone
layout["sky"] = {"platform": PLAT, "portal": PORTAL2}  # the client puts a star block on each corner
json.dump(layout, open(sys.argv[2], "w"), indent=1)
if len(sys.argv) > 3:
    open(sys.argv[3], "a").write(
        "/* the sky platform: where the portal opens when both Waddle Dees are gone */\n"
        f"#define DREAM_SKY_PORTAL_X {PORTAL2[0] + 1}\n#define DREAM_SKY_PORTAL_Y {PORTAL2[1] + 1}\n")
print(f"dreamland level 3: an {PLAT['w']}x{PLAT['d']} platform in the sky, 2 Waddle Dees")

# ---- Dreamland's fourth level: a Kirby-style grass field ------------------
# Peach pillars with rounded tops, pink-and-green checkered towers, floating
# sky platforms, pink brick ledges, ladders up everything, little grass
# mounds; Kirby enemies everywhere; the portal hidden inside a hollow
# checkered tower in a far corner, its doorway facing the woods.
r3 = random.Random(333)
g3 = [['.'] * W for _ in range(H)]
n3, s3, w3, e3 = wavy(W, 4, 10, 21), wavy(W, 4, 10, 22), wavy(H, 4, 11, 23), wavy(H, 4, 11, 24)
for y in range(H):
    for x in range(W):
        if y < n3[x] or y >= H - s3[x] or x < w3[y] or x >= W - e3[y]:
            g3[y][x] = 'T'
used = [[g3[y][x] == 'T' for x in range(W)] for y in range(H)]
def free3(x0, y0, w, d, margin=1):
    return all(0 <= x < W and 0 <= y < H and not used[y][x]
               for y in range(y0 - margin, y0 + d + margin) for x in range(x0 - margin, x0 + w + margin))
def use3(x0, y0, w, d):
    for y in range(y0, y0 + d):
        for x in range(x0, x0 + w):
            used[y][x] = True
cx, cy = W // 2, H // 2
use3(cx - 4, cy - 4, 9, 9)  # keep the arrival clear
# the hidden portal: a hollow checkered tower in the far south-east, its
# doorway on the side facing the woods
vault = None
for x0 in range(W - 22, W - 8):
    for y0 in range(H - 22, H - 8):
        if free3(x0, y0, 5, 5, 1) and (y0 + 5 >= H - s3[x0] - 3 or x0 + 5 >= W - e3[y0] - 3):
            vault = {"x": x0, "y": y0, "w": 5, "d": 5, "h": 8}
            break
    if vault:
        break
assert vault, "no room for the hidden portal's tower"
use3(vault["x"] - 1, vault["y"] - 1, 7, 7)
# its doorway: on whichever side is nearer the woods (east or south)
vault["door"] = ([vault["x"] + 4, vault["y"] + 2] if W - e3[vault["y"]] - (vault["x"] + 5) < H - s3[vault["x"]] - (vault["y"] + 5)
                 else [vault["x"] + 2, vault["y"] + 4])
PORTAL3 = (vault["x"] + 2, vault["y"] + 2)

def place(kind, w, d, tries=300, margin=2):
    for _ in range(tries):
        x0, y0 = r3.randrange(4, W - 4 - w), r3.randrange(4, H - 4 - d)
        if free3(x0, y0, w, d, margin):
            use3(x0, y0, w, d)
            return x0, y0
    return None
pillars, towers, skies, mounds = [], [], [], []
for _ in range(16):  # peach pillars, 1x1 or 2x2, a ladder and maybe a pink brick ledge
    size = r3.choice([1, 1, 2])
    p = place("pillar", size + 1, size + 1)
    if p:
        h = r3.randint(4, 11)
        pillars.append({"x": p[0], "y": p[1], "s": size, "h": h, "ledge": r3.random() < 0.6,
                        "ladder": r3.choice(["s", "e"])})  # (in its reserved corner, clear of enemies)
for _ in range(4):  # checkered towers (3x3, a ladder up the east side)
    p = place("tower", 4, 4)
    if p:
        towers.append({"x": p[0], "y": p[1], "w": 3, "d": 3, "h": r3.randint(6, 10)})
for _ in range(9):  # floating sky platforms with a ladder up
    p = place("sky", 4, 3, margin=1)
    if p:
        skies.append({"x": p[0] + 1, "y": p[1], "w": 3, "d": 2, "h": r3.randint(3, 8)})  # ladder on its west side
for _ in range(7):  # little grass mounds
    p = place("mound", 5, 5, margin=1)
    if p:
        mounds.append({"x": p[0] + 2, "y": p[1] + 2, "r": 2, "h": r3.randint(1, 2)})
stars = []
for _ in range(7):  # Kirby star-block walls, a bomb block in each: break it and the lot goes
    w, h = r3.randint(3, 5), r3.randint(2, 3)
    p = place("stars", w, 1, margin=1)
    if p:
        stars.append({"x": p[0], "y": p[1], "w": w, "h": h, "bomb": [p[0] + r3.randrange(w), r3.randrange(h)]})

# Kirby enemies everywhere (on open grass, away from everything built)
KIRBY = [("Waddle Dee", "Y"), ("Bomber", "e"), ("Noddy", "i"), ("Bronto Burt", "B"), ("Parasol Waddle Dee", "h"),
         ("Broom Hatter", ":"), ("Poppy Bros. Jr.", "k"), ("Gordo", "b"), ("Sir Kibble", "h"), ("Grizzo", "d"),
         ("Kabu", "r"), ("Waddle Doo", "e"), ("Lovely", "F")]
# one of each Kirby enemy (no cherubs here; Lovely: four, a little patch of
# them): a few start up on the checkered towers and the big pillars (and stay
# up there); the rest spread out over the field, as far from each other as
# they can be
mons3 = []
kinds = KIRBY + [("Chef Kawasaki", "O")] + [("Lovely", "F")] * 3
r3.shuffle(kinds)
tops = [(t["x"] + 1, t["y"] + 1) for t in towers] + [(p["x"], p["y"]) for p in pillars if p["s"] == 2]
r3.shuffle(tops)
for (name, cls), (x, y) in zip([k for k in kinds if k[0] != "Chef Kawasaki"][:4], tops[:4]):
    mons3.append((cls, name, x, y))
    kinds.remove((name, cls))
spots = [(x, y) for y in range(2, H - 2) for x in range(2, W - 2) if not used[y][x]]
for name, cls in kinds:
    best, far = None, -1
    for x, y in r3.sample(spots, 300):
        d = min([abs(x - mx) + abs(y - my) for _, _, mx, my in mons3] + [abs(x - cx) + abs(y - cy) + 6])
        if d > far:
            best, far = (x, y), d
    used[best[1]][best[0]] = True
    spots.remove(best)
    mons3.append((cls, name, best[0], best[1]))
# food lying about, as in Kirby (eaten in Dreamland it heals you; a melon is a
# Maxim Tomato and heals you completely)
FOOD = ["melon", "melon", "melon", "apple", "apple", "apple", "orange", "orange", "pear", "banana", "banana",
        "carrot", "candy bar", "candy bar", "cream pie", "cream pie", "fortune cookie", "huge chunk of meat",
        "huge chunk of meat", "meatball", "meatball", "pancake", "pancake", "lump of royal jelly", "cheese",
        "sandwich", "slime mold", "lembas wafer", "cram ration", "apple"]
food3 = []
for name in FOOD:
    for _ in range(400):
        x, y = r3.randrange(2, W - 2), r3.randrange(2, H - 2)
        if not used[y][x]:
            used[y][x] = True
            food3.append((name, x, y))
            break

# the border woods: a solid wall of tall weeds and grass (built by the
# client; no trees on this level)
weeds3 = [[x, y] for y in range(H) for x in range(W) if g3[y][x] == 'T']
# little flowers all over the open grass
rf3 = random.Random(33)
flowers3 = [[x, y, rf3.randrange(3)] for y in range(H) for x in range(W)
            if g3[y][x] == '.' and not used[y][x] and rf3.random() < 0.14]

des3 = [
    "# MineHack Ascend: Dreamland, level 4 (generated by tools/dreamland_gen.py)",
    'MAZE:"dreamln4",\' \'',
    "GEOMETRY:center,center",
    "MAP",
    *("".join(row) for row in g3),
    "ENDMAP",
    f"REGION:(0,0,{W - 1},{H - 1}),lit,\"ordinary\"",
    f"NON_DIGGABLE:(0,0,{W - 1},{H - 1})",
    f"TELEPORT_REGION:({cx - 3},{cy - 3},{cx + 3},{cy + 3}),(0,0,0,0)",
    *(f"MONSTER:'{c}',\"{n}\",({x},{y})" for c, n, x, y in mons3),
    *(f"OBJECT:'%',\"{n}\",({x},{y})" for n, x, y in food3),
]
open(os.path.join(os.path.dirname(sys.argv[1]) or ".", "dreamland4.des"), "w").write("\n".join(des3) + "\n")
layout["kirby"] = {"pillars": pillars, "towers": towers, "skies": skies, "mounds": mounds, "stars": stars,
                    "weeds": weeds3, "flowers": flowers3, "vault": vault, "portal": PORTAL3}
json.dump(layout, open(sys.argv[2], "w"), indent=1)
if len(sys.argv) > 3:
    open(sys.argv[3], "a").write(
        "/* the Kirby field: the portal hidden inside a checkered tower */\n"
        f"#define DREAM_KIRBY_PORTAL_X {PORTAL3[0] + 1}\n#define DREAM_KIRBY_PORTAL_Y {PORTAL3[1] + 1}\n")
print(f"dreamland level 4: {len(pillars)} pillars, {len(towers)} checkered towers, {len(skies)} sky platforms, "
      f"{len(stars)} star-block walls, {len(weeds3)} squares of weeds, {len(food3)} foods, "
      f"{len(mons3)} Kirby enemies (one of each, four Lovelys, {min(4, len(tops))} up high), portal hidden at {PORTAL3}")

# ---- Dreamland's fifth level: a white marble palace in formal gardens ------
# The palace in the middle: a temple (flat-roofed, no steeple) with stained
# glass in the nave and the chancel, the altar in the middle of the floor
# ringed by water with a flame on either side; a west and an east wing, each
# with a porch of quartz pillars.  Round it: a hedge maze in each corner of
# the gardens (a fountain and a Maxim Tomato in the middle), reflecting pools
# and a marble walk to the south, flowers everywhere, woods round the edge.  Cherubs (no corpses: that's the hard
# part) and lesser garden creatures (which do leave corpses).  A sacrifice on
# the altar opens a portal on it (the engine: pray.c hook).
r4 = random.Random(444)
g4 = [['.'] * W for _ in range(H)]
n4, s4, w4, e4 = wavy(W, 2, 4, 41), wavy(W, 2, 4, 42), wavy(H, 2, 4, 43), wavy(H, 2, 4, 44)
for y in range(H):
    for x in range(W):
        if y < n4[x] or y >= H - s4[x] or x < w4[y] or x >= W - e4[y]:
            g4[y][x] = 'T'
busy = [[g4[y][x] == 'T' for x in range(W)] for y in range(H)]
def busy4(x0, y0, w, d):
    for y in range(y0, y0 + d):
        for x in range(x0, x0 + w):
            busy[y][x] = True
TEMPLE = {"x": 48, "y": 20, "w": 23, "d": 17, "h": 9}
ALTAR = (TEMPLE["x"] + TEMPLE["w"] // 2, TEMPLE["y"] + 8)
WINGS = [{"x": 26, "y": 23, "w": 22, "d": 11, "h": 6, "side": "west"},
         {"x": 71, "y": 23, "w": 22, "d": 11, "h": 6, "side": "east"}]
busy4(TEMPLE["x"], TEMPLE["y"], TEMPLE["w"], TEMPLE["d"])
for wg in WINGS:
    busy4(wg["x"], wg["y"], wg["w"], wg["d"] + 3)  # (with its porch)
# the altar, ringed by water two squares wide; a flame on each side
for dy in range(-2, 3):
    for dx in range(-2, 3):
        if dx or dy:
            g4[ALTAR[1] + dy][ALTAR[0] + dx] = 'P'
BRAZIERS = [(ALTAR[0] - 4, ALTAR[1]), (ALTAR[0] + 4, ALTAR[1])]
# hedge mazes to the north-west and north-east (recursive backtracker)
def maze(x0, y0, cw, ch, way_in="s"):
    """a cw x ch-cell hedge maze at (x0, y0): hedge squares on a (2cw+1) x (2ch+1)
    grid (cells on odd squares), a way in on the south ("s") or north ("n")
    side; -> (hedges, middle, way in)"""
    seen, stack, gaps = {(0, 0)}, [(0, 0)], set()
    while stack:
        cxm, cym = stack[-1]
        nbrs = [(cxm + dx, cym + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= cxm + dx < cw and 0 <= cym + dy < ch and (cxm + dx, cym + dy) not in seen]
        if not nbrs:
            stack.pop()
            continue
        nx_, ny_ = r4.choice(nbrs)
        gaps.add((cxm + nx_ + 1, cym + ny_ + 1))  # the grid square between the two cells
        seen.add((nx_, ny_))
        stack.append((nx_, ny_))
    entrance = (2 * (cw // 2) + 1, 2 * ch if way_in == "s" else 0)
    hedge = [[x0 + gx, y0 + gy] for gy in range(2 * ch + 1) for gx in range(2 * cw + 1)
             if not (gx % 2 == 1 and gy % 2 == 1) and (gx, gy) not in gaps and (gx, gy) != entrance]
    return hedge, (x0 + 2 * (cw // 2) + 1, y0 + 2 * (ch // 2) + 1), [x0 + entrance[0], y0 + entrance[1]]
# four hedge mazes, one in each corner of the gardens: three blocks tall, a
# marble archway on quartz pillars at the way in (facing the palace), a
# fountain in the middle and a Maxim Tomato (a melon) beside it for whoever
# finds it
hedges, fountains, arches, prizes = [], [], [], []
for mx0, my0, cw, ch, way in ((8, 5, 15, 6, "s"), (78, 5, 15, 6, "s"), (6, 43, 16, 6, "n"), (79, 43, 16, 6, "n")):
    h, mid, gate = maze(mx0, my0, cw, ch, way)
    hedges += h
    fountains.append(mid)
    arches.append(gate)
    prizes.append((mid[0] + 2, mid[1]))
    busy4(mx0 - 1, my0 - 1, 2 * cw + 3, 2 * ch + 3)
# the south garden: a marble walk from the arrival up to the temple door,
# two fountains, two reflecting pools
paving = []
door = (ALTAR[0], TEMPLE["y"] + TEMPLE["d"] - 1)
for y in range(door[1] + 1, H - 6):
    for x in range(door[0] - 1, door[0] + 2):
        paving.append([x, y])
        busy[y][x] = True
for x in range(WINGS[0]["x"] + 2, WINGS[1]["x"] + WINGS[1]["w"] - 2):  # a cross walk past the porches
    for y in (40, 41):
        if [x, y] not in paving:
            paving.append([x, y])
        busy[y][x] = True
for fx_, fy_ in fountains:
    g4[fy_][fx_] = '{'
    busy4(fx_ - 1, fy_ - 1, 3, 3)
for px0 in (46, 64):  # reflecting pools either side of the walk
    for y in range(45, 51):
        for x in range(px0, px0 + 8):
            g4[y][x] = 'P'
    busy4(px0 - 1, 44, 10, 8)
# flowers everywhere else on the grass
flowers = []
for _ in range(5000):
    if len(flowers) >= 650:
        break
    x, y = r4.randrange(2, W - 2), r4.randrange(2, H - 2)
    if not busy[y][x] and g4[y][x] == '.':
        flowers.append([x, y, r4.randrange(3)])
        busy[y][x] = True
# cherubs in the gardens, spread out
cher = []
spots4 = [(x, y) for y in range(3, H - 3) for x in range(3, W - 3) if not busy[y][x] and g4[y][x] == '.']
for _ in range(2):  # only two cherubs, out in the gardens
    best, far = None, -1
    for x, y in r4.sample(spots4, 200):
        d = min([abs(x - a) + abs(y - b) for a, b in cher] + [99])
        if d > far:
            best, far = (x, y), d
    cher.append(best)
# lesser garden creatures: cherubs leave no corpse, so these are what you
# can bring to the altar
critters = []
for cls, name, n in [("r", "rabbit", 3), ("S", "garter snake", 3), (":", "newt", 2), (":", "gecko", 2)]:
    for _ in range(n):
        x, y = r4.choice(spots4)
        spots4.remove((x, y))
        critters.append((cls, name, x, y))
des4 = [
    "# MineHack Ascend: Dreamland, level 5 (generated by tools/dreamland_gen.py)",
    'MAZE:"dreamln5",\' \'',
    "GEOMETRY:center,center",
    "MAP",
    *("".join(row) for row in g4),
    "ENDMAP",
    f"REGION:(0,0,{W - 1},{H - 1}),lit,\"ordinary\"",
    f"NON_DIGGABLE:(0,0,{W - 1},{H - 1})",
    f"TELEPORT_REGION:({door[0] - 3},{H - 9},{door[0] + 3},{H - 7}),(0,0,0,0)",  # the south end of the walk
    f"ALTAR:({ALTAR[0]},{ALTAR[1]}),random,altar",
    *(f"MONSTER:'A',\"cherub\",({x},{y}),hostile" for x, y in cher),
    *(f"OBJECT:'%',\"melon\",({x},{y})" for x, y in prizes),
    *(f"MONSTER:'{c}',\"{n}\",({x},{y}),hostile" for c, n, x, y in critters),
]
open(os.path.join(os.path.dirname(sys.argv[1]) or ".", "dreamland5.des"), "w").write("\n".join(des4) + "\n")
layout["palace"] = {"temple": TEMPLE, "altar": ALTAR, "wings": WINGS, "braziers": BRAZIERS, "hedges": hedges, "arches": arches,
                    "paving": paving, "flowers": flowers, "door": door,
                    # the woods round the gardens: a wall of tall weeds (no trees)
                    "weeds": [[x, y] for y in range(H) for x in range(W) if g4[y][x] == 'T']}
json.dump(layout, open(sys.argv[2], "w"), indent=1)
if len(sys.argv) > 3:
    open(sys.argv[3], "a").write(
        "/* the palace: its altar (anything offered there opens a portal in one of the hedge mazes) */\n"
        f"#define DREAM_PALACE_ALTAR_X {ALTAR[0] + 1}\n#define DREAM_PALACE_ALTAR_Y {ALTAR[1] + 1}\n"
        "/* ...on the open square beside a maze's middle fountain, the maze picked per game */\n"
        "#define DREAM_PALACE_MAZE_PORTALS { " + ", ".join(f"{{ {x + 1}, {y + 1} }}" for x, y in prizes) + " }\n")
print(f"dreamland level 5: the marble palace, {len(arches)} hedge mazes ({len(hedges)} hedges), {len(fountains)} fountains, "
      f"{len(flowers)} flowers, {len(cher)} cherubs, {len(critters)} garden creatures")

# ---- Dreamland's sixth level: the Fountain of Dreams ------------------------
# A round island floating in the night sky among the stars: a grass ring
# round a pool, and in the middle of the pool a quartz fountain, three tiers
# high, with the Star Rod standing on top, flashing.  Iridescent water spills
# from the fountain's bowls into the pool, and over the island's edge into
# the sky all round, and four gushers leap up out of the pool.  Four lavender
# towers, little red and green cone trees, star blocks about, pink clouds
# swirling round it all, and Kirby (a deep one at heart) waiting.  The engine
# has the island, the pool and the open air; the client builds the rest
# (dreamland.json "fountain").
R5 = 13.5  # the island's radius
POOL = (3.2, 7.6)  # the pool: a ring between these radii (the fountain stands inside it)
c5x, c5y = W // 2, H // 2
g5 = [['A'] * W for _ in range(H)]  # open air all round
island, pool5 = [], []
for y in range(H):
    for x in range(W):
        r = math.hypot(x - c5x, y - c5y)
        if r <= R5:
            island.append([x, y])
            if POOL[0] < r <= POOL[1]:
                g5[y][x] = 'P'
                pool5.append([x, y])
            else:
                g5[y][x] = '.'
r5 = random.Random(5)
# the fountain: a basin (a marble rim round the middle), a quartz column, a
# wide bowl, a narrow bowl, the Star Rod on top
FOUNT = {"x": c5x, "y": c5y, "bowl": 4, "top": 7}
# four lavender towers on the grass ring, on the diagonals
towers5 = [{"x": round(c5x + 10.2 * dx), "y": round(c5y + 10.2 * dy), "h": r5.randint(7, 9)}
           for dx, dy in ((0.707, 0.707), (-0.707, 0.707), (0.707, -0.707), (-0.707, -0.707))]
# star blocks scattered about the grass, away from the towers and the arrival
ARRIVE5 = (c5x, c5y + 10)
grass5 = [(x, y) for x, y in island if g5[y][x] == '.' and math.hypot(x - c5x, y - c5y) > POOL[1] + 0.8
          and math.hypot(x - c5x, y - c5y) < R5 - 1]
stars5 = []
for x, y in r5.sample(grass5, len(grass5)):
    if len(stars5) >= 9:
        break
    if any(abs(x - t["x"]) <= 2 and abs(y - t["y"]) <= 2 for t in towers5) or math.hypot(x - ARRIVE5[0], y - ARRIVE5[1]) < 4:
        continue
    if any(abs(x - a) + abs(y - b) < 4 for a, b, _ in stars5):
        continue
    stars5.append([x, y, r5.choice([1, 1, 2])])
KIRBY5 = (c5x, c5y - 10)  # across the pool from where you arrive
# four gushers of iridescent water leaping up out of the pool round the
# fountain, and little cone trees, red and green, dotted over the grass
gushers5 = [[c5x + dx, c5y + dy] for dx, dy in ((0, -5), (5, 0), (0, 5), (-5, 0))]
assert all(g5[y][x] == 'P' for x, y in gushers5)
cones5 = []
for x, y in r5.sample(grass5, len(grass5)):
    if len(cones5) >= 12:
        break
    if any(abs(x - t["x"]) <= 2 and abs(y - t["y"]) <= 2 for t in towers5) or math.hypot(x - ARRIVE5[0], y - ARRIVE5[1]) < 3:
        continue
    if any(abs(x - a) + abs(y - b) < 3 for a, b, _ in stars5 + cones5) or (x, y) == KIRBY5:
        continue
    cones5.append([x, y, len(cones5) % 2])  # 0: green, 1: red
# the trial: Kirby, then (after a pause, and maybe some food) two Waddle Doos,
# a cherub, Kirby again (the engine runs it: winweb.c web_dream_waves), and
# then a portal opens on one of these grass squares (picked per game)
portals5 = []
for x, y in r5.sample(grass5, len(grass5)):
    if len(portals5) >= 8:
        break
    if any(abs(x - t["x"]) <= 2 and abs(y - t["y"]) <= 2 for t in towers5) or (x, y) == KIRBY5:
        continue
    if any(abs(x - a) + abs(y - b) < 2 for a, b, *_ in stars5 + cones5) or any(abs(x - a) + abs(y - b) < 6 for a, b in portals5):
        continue
    portals5.append([x, y])
# when Kirby first falls, the Star Rod pops off the fountain and lands on the
# grass just south of the pool (a square with nothing built on it)
ROD5 = min((g for g in grass5 if not any((g[0], g[1]) == (a, b) for a, b, *_ in stars5 + cones5)),
           key=lambda g: math.hypot(g[0] - c5x, g[1] - (c5y + POOL[1] + 1.2)))
des5 = [
    "# MineHack Ascend: Dreamland, level 6, the Fountain of Dreams (generated by tools/dreamland_gen.py)",
    'MAZE:"dreamln6",\' \'',
    "GEOMETRY:center,center",
    "MAP",
    *("".join(row) for row in g5),
    "ENDMAP",
    f"REGION:(0,0,{W - 1},{H - 1}),lit,\"ordinary\"",
    f"NON_DIGGABLE:(0,0,{W - 1},{H - 1})",
    # you come up through the portal onto the south of the grass ring
    f"TELEPORT_REGION:({ARRIVE5[0] - 1},{ARRIVE5[1] - 1},{ARRIVE5[0] + 1},{ARRIVE5[1] + 1}),(0,0,0,0)",
    f"MONSTER:'h',\"Kirby\",({KIRBY5[0]},{KIRBY5[1]}),hostile",
]
open(os.path.join(os.path.dirname(sys.argv[1]) or ".", "dreamland6.des"), "w").write("\n".join(des5) + "\n")
layout["fountain"] = {"center": [c5x, c5y], "radius": R5, "island": island, "fountain": FOUNT,
                    "towers": towers5, "stars": stars5, "gushers": gushers5, "cones": cones5}
json.dump(layout, open(sys.argv[2], "w"), indent=1)
if len(sys.argv) > 3:
    open(sys.argv[3], "a").write(
        "/* the Fountain of Dreams: where the trial's waves come from (Kirby's square) */\n"
        f"#define DREAM_FTN_SPAWN_X {KIRBY5[0] + 1}\n#define DREAM_FTN_SPAWN_Y {KIRBY5[1] + 1}\n"
        "/* ...the island's middle and radius (food lands on its grass) */\n"
        f"#define DREAM_FTN_CX {c5x + 1}\n#define DREAM_FTN_CY {c5y + 1}\n#define DREAM_FTN_R {int(R5)}\n"
        "/* ...an air square in the corner whose spare flags hold the trial's wave */\n"
        "#define DREAM_FTN_FLAG_X 1\n#define DREAM_FTN_FLAG_Y 1\n"
        "/* ...where the Star Rod lands when it pops off the fountain (Kirby's first defeat) */\n"
        f"#define DREAM_FTN_ROD_X {ROD5[0] + 1}\n#define DREAM_FTN_ROD_Y {ROD5[1] + 1}\n"
        "/* ...and where the portal opens when it's over, the square picked per game */\n"
        "#define DREAM_FTN_PORTALS { " + ", ".join(f"{{ {x + 1}, {y + 1} }}" for x, y in portals5) + " }\n")
print(f"dreamland level 6: the Fountain of Dreams, an island of {len(island)} squares ({len(pool5)} of pool), "
      f"{len(towers5)} towers, {len(stars5)} star blocks, {len(gushers5)} gushers, {len(cones5)} cone trees, Kirby")

# ---- Dreamland's seventh level: the palace at night, a battle ---------------
# Level 5's white marble palace and gardens again (the client builds the same
# scenery), but at night under the stars, and full of NetHack monsters to
# fight: lots of ordinary ones, some harder ones, some strange ones, all
# hostile, spread through the gardens.  A chance to level up.
MONCLASS = {"S_DOG": "d", "S_KOBOLD": "k", "S_ORC": "o", "S_ANT": "a", "S_GNOME": "G", "S_RODENT": "r",
            "S_HUMANOID": "h", "S_SNAKE": "S", "S_ZOMBIE": "Z", "S_MUMMY": "M", "S_IMP": "i", "S_TROLL": "T",
            "S_OGRE": "O", "S_GIANT": "H", "S_HUMAN": "@", "S_CENTAUR": "C", "S_YETI": "Y", "S_QUADRUPED": "q",
            "S_DRAGON": "D", "S_NAGA": "N", "S_GREMLIN": "g", "S_EYE": "e", "S_FUNGUS": "F", "S_NYMPH": "n",
            "S_LEPRECHAUN": "l", "S_BLOB": "b", "S_JELLY": "j", "S_LIGHT": "y", "S_MIMIC": "m",
            "S_COCKATRICE": "c", "S_QUANTMECH": "Q", "S_XAN": "x", "S_RUSTMONST": "R"}
BATTLE6 = [  # (monster, its class, how many)
    # the ordinary crowd
    ("jackal", "S_DOG", 4), ("coyote", "S_DOG", 3), ("large kobold", "S_KOBOLD", 3), ("hill orc", "S_ORC", 4),
    ("Mordor orc", "S_ORC", 2), ("giant ant", "S_ANT", 2), ("gnome lord", "S_GNOME", 3), ("giant rat", "S_RODENT", 3),
    ("hobbit", "S_HUMANOID", 2), ("dwarf", "S_HUMANOID", 2), ("kobold zombie", "S_ZOMBIE", 3),
    ("gnome mummy", "S_MUMMY", 2), ("gnoll", "S_GNOME", 2), ("homunculus", "S_IMP", 2), ("snake", "S_SNAKE", 1),
    # harder ones
    ("soldier ant", "S_ANT", 2), ("dwarf lord", "S_HUMANOID", 1), ("soldier", "S_HUMAN", 2), ("sergeant", "S_HUMAN", 1),
    ("ogre", "S_OGRE", 1), ("owlbear", "S_YETI", 1), ("rothe", "S_QUADRUPED", 2), ("forest centaur", "S_CENTAUR", 1),
    ("wolf", "S_DOG", 2), ("warg", "S_DOG", 1), ("leocrotta", "S_QUADRUPED", 1), ("troll", "S_TROLL", 1),
    ("hill giant", "S_GIANT", 1), ("baby red dragon", "S_DRAGON", 1), ("gargoyle", "S_GREMLIN", 1),
    # and the strange ones
    ("floating eye", "S_EYE", 2), ("violet fungus", "S_FUNGUS", 1), ("wood nymph", "S_NYMPH", 2),
    ("leprechaun", "S_LEPRECHAUN", 2), ("acid blob", "S_BLOB", 2), ("blue jelly", "S_JELLY", 1),
    ("yellow light", "S_LIGHT", 2), ("small mimic", "S_MIMIC", 1), ("chickatrice", "S_COCKATRICE", 1),
    ("quantum mechanic", "S_QUANTMECH", 2), ("grid bug", "S_XAN", 3), ("lichen", "S_FUNGUS", 2),
    ("gelatinous cube", "S_BLOB", 1), ("killer bee", "S_ANT", 3), ("shrieker", "S_FUNGUS", 1), ("tengu", "S_IMP", 1),
    ("rust monster", "S_RUSTMONST", 1), ("red naga hatchling", "S_NAGA", 1), ("quasit", "S_IMP", 1),
]
r6 = random.Random(6)
arrive6 = (door[0], H - 8)  # (where you arrive: the south end of the marble walk)
spots6 = [(x, y) for y in range(3, H - 3) for x in range(3, W - 3)
          if not busy[y][x] and g4[y][x] == '.' and abs(x - arrive6[0]) + abs(y - arrive6[1]) > 9]
r6.shuffle(spots6)
battle6 = []
for name, cls, n in BATTLE6:
    for _ in range(n):
        x, y = spots6.pop()
        battle6.append((MONCLASS[cls], name, x, y))
des6 = [
    "# MineHack Ascend: Dreamland, level 7 (generated by tools/dreamland_gen.py): the palace at night, a battle",
    'MAZE:"dreamln7",\' \'',
    "GEOMETRY:center,center",
    "MAP",
    *("".join(row) for row in g4),
    "ENDMAP",
    f"REGION:(0,0,{W - 1},{H - 1}),lit,\"ordinary\"",
    f"NON_DIGGABLE:(0,0,{W - 1},{H - 1})",
    f"TELEPORT_REGION:({door[0] - 3},{H - 9},{door[0] + 3},{H - 7}),(0,0,0,0)",
    f"ALTAR:({ALTAR[0]},{ALTAR[1]}),random,altar",
    *(f"OBJECT:'%',\"melon\",({x},{y})" for x, y in prizes),
    *(f"MONSTER:'{c}',\"{n}\",({x},{y}),hostile" for c, n, x, y in battle6),
]
open(os.path.join(os.path.dirname(sys.argv[1]) or ".", "dreamland7.des"), "w").write("\n".join(des6) + "\n")
print(f"dreamland level 7: the palace at night, {len(battle6)} monsters ({len(BATTLE6)} kinds)")

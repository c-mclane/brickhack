#!/usr/bin/env python3
"""Build an alternative tileset for MineHack.

Writes web/assets/tilesets/<name>/tiles.png + tiles.json: an atlas with the
same tile numbering as SLASH'EM's own (web/assets/slashem/tiles.json), each
tile taken from, in order:

  1. a NetHack 3.4.3 tile sheet (RLTiles' nh32 for dcss, your own sheet for
     absurd), matched by name: NetHack's monster, object and map-feature
     names, from its 3.4.3 tile lists (vendor/tilesets/nethack343)
  2. for dcss, modern Dungeon Crawl Stone Soup art (vendor/crawl), matched by
     name, for what SLASH'EM adds to NetHack
  3. SLASH'EM's own tile, scaled up

MineHack's own monsters (mods/monsters) always keep their own tiles.

  dcss    Dungeon Crawl style: RLTiles' 32x32 NetHack tileset and Dungeon
          Crawl Stone Soup's art, all public domain (RLTiles / CC0)
  absurd  the Absurd tileset, which can't be redistributed: put its NetHack
          3.4.3 sheet (any size: 32, 48, 64, 128...) in art/tilesets/ as
          absurd*.png (local only); it's drawn at up to 64px

Sources (git-ignored, under vendor/):
  vendor/tilesets/rltiles-nh32/nh32.bmp   https://rltiles.sourceforge.net/nh32.zip
  vendor/tilesets/nethack343/*.txt        win/share/{monsters,objects,other}.txt of
                                          https://www.nethack.org/download/3.4.3/nethack-343-src.tgz
  vendor/crawl                            DCSS's rltiles (see tools/tilesets/README.md)

usage: build_tileset.py dcss|absurd [--report]
"""
import glob
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V = os.path.join(ROOT, "vendor")
SRC = os.path.join(ROOT, "web/assets/slashem")
KEY = (71, 108, 108)  # the atlas's see-through colour


# ---- NetHack 3.4.3's tile names, in sheet order ----------------------------
def tile_names(path):
    return [re.match(r"# tile \d+ \((.*)\)", l).group(1)
            for l in open(path, encoding="latin-1") if l.startswith("# tile ")]


def nethack_names():
    d = os.path.join(V, "tilesets/nethack343")
    return [tile_names(os.path.join(d, f + ".txt")) for f in ("monsters", "objects", "other")]


def sheet_lookup(path, size):
    """name key -> tile image, for a NetHack 3.4.3 sheet with size-px tiles"""
    sheet = Image.open(path)
    sheet = sheet.convert("RGBA" if "A" in sheet.getbands() or "transparency" in sheet.info else "RGB")
    cols = sheet.width // size
    mons, objs, other = nethack_names()
    found, k = {}, 0
    for section, names in (("m", mons), ("o", objs), ("f", other)):
        seen = {}
        for n in names:
            # map features repeat names (wall, wall...): keyed by occurrence too
            key = (section, n.lower(), seen.get(n, 0) if section == "f" else 0)
            seen[n] = seen.get(n, 0) + 1
            box = ((k % cols) * size, (k // cols) * size, (k % cols) * size + size, (k // cols) * size + size)
            if box[3] <= sheet.height:
                found.setdefault(key, sheet.crop(box))
            k += 1
    floor = found.get(("f", "floor of a room", 0))
    if sheet.mode == "RGB" and floor is not None:
        # tiles drawn on the floor (RLTiles'): the floor's pixels become see-through
        found = {key: (unfloor(t, floor) if key != ("f", "floor of a room", 0) else t) for key, t in found.items()}
    return found


def unfloor(tile, floor):
    """a tile with the floor's own pixels (same colour, same spot) see-through"""
    out = tile.convert("RGBA")
    px, fl = out.load(), floor.load()
    for y in range(out.height):
        for x in range(out.width):
            if px[x, y][:3] == fl[x, y][:3]:
                px[x, y] = (0, 0, 0, 0)
    out.info["solid"] = tile  # (for tiles SLASH'EM draws solid: lava, water...)
    return out


# ---- modern Dungeon Crawl Stone Soup art, by name ----------------------------
RL = os.path.join(V, "crawl/crawl-ref/source/rltiles")


def norm(s):
    s = os.path.splitext(os.path.basename(s))[0].lower()
    s = re.sub(r"^(i-|gem_)", "", s)
    s = re.sub(r"[_\-\s]+", " ", s).strip()
    return re.sub(r"\s*\d+$", "", s)  # numbered variants (long_sword1)


def dcss_index():
    def index(folder):
        found = {}
        for f in sorted(glob.glob(os.path.join(RL, folder, "**", "*.png"), recursive=True)):
            found.setdefault(norm(f), f)
        return found
    mon = index("mon")
    for lst in glob.glob(os.path.join(RL, "dc-*.txt")):  # DCSS's own names: MONS_GNOME_LORD -> gnome lord
        sdir = ""
        for line in open(lst):
            line = line.strip()
            if line.startswith("%sdir"):
                sdir = line.split()[1]
            m = re.match(r"^(\S+)\s+MONS_(\w+)", line)
            if m and os.path.exists(os.path.join(RL, sdir, m.group(1) + ".png")):
                mon.setdefault(m.group(2).lower().replace("_", " "), os.path.join(RL, sdir, m.group(1) + ".png"))
    items = {d: index(os.path.join("item", d)) for d in
             ("weapon", "armour", "food", "gem", "misc", "potion", "ring", "amulet", "book", "wand", "gold")}
    return mon, items, index("item")


def object_classes():
    """SLASH'EM object name -> DCSS item folder (from objects.c's macros)"""
    src = open(os.path.join(V, "SlashEM/src/objects.c"), encoding="latin-1").read()
    macro = {"WEAPON": "weapon", "PROJECTILE": "weapon", "BOW": "weapon", "GUN": "weapon", "BULLET": "weapon",
             "WEPTOOL": "weapon", "ARMOR": "armour", "HELM": "armour", "CLOAK": "armour", "SHIELD": "armour",
             "GLOVES": "armour", "BOOTS": "armour", "DRGN_ARMR": "armour", "RING": "ring", "AMULET": "amulet",
             "TOOL": "misc", "CONTAINER": "misc", "FOOD": "food", "POTION": "potion", "SCROLL": "scroll",
             "SPELL": "book", "WAND": "wand", "COIN": "gold", "GEM": "gem", "ROCK": "misc"}
    classes = {}
    for m, name in re.findall(r"\b([A-Z_]+)\(\s*\"([^\"]+)\"", src):
        if m in macro:
            classes.setdefault(name, macro[m])
    return classes


def dcss_finder():
    if not os.path.isdir(RL):
        print("  (no vendor/crawl: SLASH'EM's additions keep SLASH'EM tiles)")
        return None
    mon, items, any_item = dcss_index()
    classes = object_classes()

    def find(section, name):
        if section == "m":
            return mon.get(name.lower())
        look, _, real = name.partition(" / ")
        real = real or look
        cls = classes.get(real)
        if cls in ("potion", "ring", "amulet", "book"):
            return items[cls].get(norm(look))
        if cls == "wand":
            return items["wand"].get(norm(look)) or items["wand"].get("wood")
        if cls in items:
            return items[cls].get(norm(real)) or items[cls].get(norm(look))
        return any_item.get(norm(real))
    return find


def fit(im, size):
    """a tile as size x size RGB on the key colour (tall art fitted, feet down)"""
    im = im.convert("RGBA")
    if im.size != (size, size):
        k = min(size / im.width, size / im.height)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.NEAREST)
    out = Image.new("RGBA", (size, size), KEY + (255,))
    out.alpha_composite(im, ((size - im.width) // 2, size - im.height))
    px = out.load()
    for y in range(size):
        for x in range(size):
            if px[x, y][3] < 255:
                px[x, y] = KEY + (255,)
    return out.convert("RGB")


# ---- the tilesets -------------------------------------------------------------
def sources(name):
    """-> (output tile size, NetHack-sheet lookup, extra finder, description)"""
    if name == "dcss":
        nh32 = os.path.join(V, "tilesets/rltiles-nh32/nh32.bmp")
        return 32, sheet_lookup(nh32, 32), dcss_finder(), \
            "Dungeon Crawl style: RLTiles' NetHack tileset and Dungeon Crawl Stone Soup art (public domain / CC0)"
    if name == "absurd":
        sheets = sorted(glob.glob(os.path.join(ROOT, "art/tilesets/absurd*.png")))
        if not sheets:
            sys.exit("put the Absurd tileset's NetHack 3.4.3 sheet in art/tilesets/ as absurd*.png")
        im = Image.open(sheets[0])
        size = next(s for s in (128, 96, 64, 48, 32, 16)
                    if im.width % s == 0 and (im.width // s) * (im.height // s) >= 1057)
        print(f"  {os.path.basename(sheets[0])}: {size}px tiles")
        return min(size, 64), sheet_lookup(sheets[0], size), None, "Absurd tileset (local copy, not redistributed)"
    sys.exit("usage: build_tileset.py dcss|absurd [--report]")


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    size, sheet, extra, about = sources(name)
    meta = json.load(open(os.path.join(SRC, "tiles.json")))
    base = Image.open(os.path.join(SRC, "tiles.png")).convert("RGB")
    cols, rows, S, names = meta["cols"], meta["rows"], meta.get("size", 16), meta["names"]
    custom = {json.load(open(f))["name"].lower() for f in glob.glob(os.path.join(ROOT, "mods/monsters/*.json"))}
    first_obj = names.index("strange object")
    first_feat = names.index("unexplored area")
    atlas = Image.new("RGB", (cols * size, rows * size), KEY)
    got = {"sheet": 0, "extra": 0, "slashem": 0}
    seen, misses = {}, []
    for i, n in enumerate(names):
        section = "m" if i < first_obj else "o" if i < first_feat else "f"
        occ = seen.get(n, 0) if section == "f" else 0
        if section == "f":
            seen[n] = seen.get(n, 0) + 1
        tile = None
        if not (section == "m" and n.lower() in custom):  # our own monsters keep their own art
            tile = sheet.get((section, n.lower(), occ))
            if tile is not None:
                got["sheet"] += 1
                own = base.crop(((i % cols) * S, (i // cols) * S, (i % cols) * S + S, (i // cols) * S + S))
                if "solid" in tile.info and KEY not in own.getdata():
                    tile = tile.info["solid"]  # SLASH'EM draws this one solid: so do we
            elif extra and section != "f":
                f = extra(section, n)
                if f:
                    tile = Image.open(f)
                    got["extra"] += 1
        if tile is None:
            got["slashem"] += 1
            misses.append(n)
            tile = base.crop(((i % cols) * S, (i // cols) * S, (i % cols) * S + S, (i // cols) * S + S))
        atlas.paste(fit(tile, size), ((i % cols) * size, (i // cols) * size))
    out = os.path.join(ROOT, "web/assets/tilesets", name)
    os.makedirs(out, exist_ok=True)
    atlas.save(os.path.join(out, "tiles.png"), optimize=True)
    json.dump({**meta, "size": size, "tileset": name, "credit": about}, open(os.path.join(out, "tiles.json"), "w"))
    print(f"{name}: {got['sheet']} from the NetHack sheet, {got['extra']} from Dungeon Crawl, "
          f"{got['slashem']} SLASH'EM tiles kept (of {len(names)})")
    if "--report" in sys.argv:
        print("  kept: " + ", ".join(misses))


main()

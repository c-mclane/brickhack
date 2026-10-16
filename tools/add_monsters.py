#!/usr/bin/env python3
"""Add the custom monsters in mods/monsters/*.json to the SLASH'EM source.

Each file:  {"name": "template monster", "base": "monkey", "tile": [16 x 16 chars]}
  optional:  "replace": [["old text", "new text"], ...]  edits to the copied
             monster entry (level, attacks, generation flags, ...);
             "nogen": true  never randomly generated (only where a special
             level places it, e.g. the template);
             no "tile": the base monster's tile is reused
  - src/monst.c:                  a copy of the base monster's entry, renamed,
                                  inserted right after the base monster
  - win/share/monsters.txt:       the 16x16 tile (palette letters of that
                                  file, M = transparent), after the base's tile;
                                  all tiles are renumbered
  - include/patchlevel.h:         EDITLEVEL = number of custom monsters, so
                                  saves from a build with a different monster
                                  list are refused cleanly instead of breaking

Starts from SLASH'EM's own monst.c and monsters.txt every time (restored
from the vendor git checkout), so edited definitions always take effect.
usage: add_monsters.py <slashem source dir> <mods/monsters dir>
"""
import glob
import json
import re
import subprocess
import sys

src, mods = sys.argv[1], sys.argv[2]
defs = [json.load(open(f)) for f in sorted(glob.glob(f"{mods}/*.json"))]


def read(rel):
    return open(f"{src}/{rel}", encoding="latin-1").read()


def write(rel, s):
    open(f"{src}/{rel}", "w", encoding="latin-1").write(s)


def mon_entry(s, name):
    """(start, end) of MON("name", ...), including the trailing comma/newline."""
    m = re.search(r'MON\("%s",' % re.escape(name), s)
    if not m:
        sys.exit(f"add_monsters: no monster called {name!r} in monst.c")
    i = m.start() + 3  # at '('
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "(":
            depth += 1
        elif s[j] == ")":
            depth -= 1
            if depth == 0:
                end = s.index("\n", j) + 1  # rest of the line ("),")
                return m.start(), end
    sys.exit("add_monsters: unbalanced MON entry for " + name)


# start from the pristine files, so changed definitions are applied afresh
subprocess.run(["git", "-C", src, "checkout", "--", "src/monst.c", "win/share/monsters.txt"], check=True)
monst = read("src/monst.c")
tiles = read("win/share/monsters.txt")
for d in defs:
    name, base, tile = d["name"], d["base"], d.get("tile")
    if tile is None:  # reuse the base monster's tile
        m = re.search(r"# tile \d+ \(%s\)\n\{\n((?:  .*\n){16})\}" % re.escape(base), tiles)
        if not m:
            sys.exit(f"add_monsters: no tile for {base!r} in monsters.txt")
        tile = [r.strip() for r in m.group(1).splitlines()]
    if len(tile) != 16 or any(len(r) != 16 for r in tile):
        sys.exit(f"add_monsters: {name}: tile must be 16 rows of 16 characters")
    if f'MON("{name}",' not in monst:
        a, b = mon_entry(monst, base)
        entry = monst[a:b].replace(f'MON("{base}",', f'MON("{name}",', 1)
        for old, new in d.get("replace", []):
            if old not in entry:
                sys.exit(f"add_monsters: {name}: {old!r} not in the {base} entry")
            entry = entry.replace(old, new, 1)
        if d.get("nogen"):
            # the generation flags follow LVL(...): keep only genocidability
            entry, n = re.subn(r"(LVL\((?:[^()]|\([^()]*\))*\),\s*)\(([^)]*)\)",
                               lambda m: m.group(1) + "(G_NOGEN" + ("|G_GENO" if "G_GENO" in m.group(2) else "") + ")",
                               entry, count=1)
            if not n:
                sys.exit(f"add_monsters: {name}: no generation flags found to change")
        monst = monst[:b] + f"    /* MineHack custom monster (mods/monsters), based on {base} */\n    " + entry + monst[b:]
    if f"({name})" not in tiles:
        m = re.search(r"# tile \d+ \(%s\)\n\{\n(?:.*\n)*?\}\n" % re.escape(base), tiles)
        if not m:
            sys.exit(f"add_monsters: no tile for {base!r} in monsters.txt")
        block = f"# tile 0 ({name})\n{{\n" + "".join(f"  {r}\n" for r in tile) + "}\n"
        tiles = tiles[:m.end()] + block + tiles[m.end():]

# renumber every tile sequentially
n = iter(range(100000))
tiles = re.sub(r"^# tile \d+ \(", lambda m: f"# tile {next(n)} (", tiles, flags=re.M)
write("src/monst.c", monst)
write("win/share/monsters.txt", tiles)

pl = read("include/patchlevel.h")
# 50 = the bigger map and Ascend's option (also save-format changes)
pl = re.sub(r"#define EDITLEVEL\s+\d+", f"#define EDITLEVEL\t{50 + len(defs)}", pl)
write("include/patchlevel.h", pl)
print(f"custom monsters: {', '.join(d['name'] for d in defs) or 'none'} (EDITLEVEL {50 + len(defs)})")

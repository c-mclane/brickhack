#!/usr/bin/env python3
"""Write art/monsters/MONSTERS.txt (every monster name, custom ones included)
from the generated tile metadata. usage: monster_list.py <tiles.json> <out>"""
import json
import sys

names = json.load(open(sys.argv[1]))["names"]
end = next(i for i, n in enumerate(names) if n in ("strange object", "dummy object"))
open(sys.argv[2], "w").write(
    "# SLASH'EM monster names (custom MineHack monsters included).\n"
    "# Save a sprite as art/monsters/<name>.png to change that monster's look in 3D,\n"
    "# or use one as the base for a new monster: npm run monster -- \"Name\" <base> sprite.png\n"
    + "\n".join(names[:end]) + "\n")
print(end, "monsters listed")

#!/bin/sh
# Fetch (if needed), patch and build SLASH'EM 0.0.8E0F2 (hardfought tree)
# with the "web" window port.  Result: build/slashem/slashemdir/slashem
set -e

# `make install` deletes the whole game directory (rm -rf), so keep the
# player's saves, bones and score files across rebuilds.
keep_player_data() { # $1 = game dir, $2 = backup dir
    mkdir -p "$2"
    [ -d "$1" ] || return 0
    for f in "$1"/save "$1"/record "$1"/logfile "$1"/xlogfile "$1"/perm "$1"/bon*; do
        [ -e "$f" ] && cp -a "$f" "$2"/
    done
    return 0
}
restore_player_data() { # $1 = game dir, $2 = backup dir
    cp -a "$2"/. "$1"/
    rm -rf "$2"
}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SE=$ROOT/vendor/SlashEM
OUT=$ROOT/build/slashem

if [ ! -d "$SE" ]; then
    git clone --depth 1 https://github.com/k21971/SlashEM.git "$SE"
fi

# 1. window port source
mkdir -p "$SE/win/web"
cp "$ROOT/port/winweb.c" "$SE/win/web/winweb.c"

# engine hooks for the block world (monsters, climbing, fall damage, pick-axe)
python3 "$ROOT/tools/patch_engine.py" "$SE"
# custom monsters (mods/monsters/*.json): monster table entries + game tiles
python3 "$ROOT/tools/add_monsters.py" "$SE" "$ROOT/mods/monsters"
# the client's tile atlas must match the engine's tile numbers (custom
# monsters shift every tile after them)
python3 "$ROOT/tools/tiles2png.py" "$SE" "$ROOT/web/assets/slashem/tiles.png" "$ROOT/web/assets/slashem/tiles.json"
python3 "$ROOT/tools/monster_list.py" "$ROOT/web/assets/slashem/tiles.json" "$ROOT/art/monsters/MONSTERS.txt"
# Ascend's level: the meadow before the golden castle (and where the castle stands, for the client)
python3 "$ROOT/tools/dreamland_gen.py" "$SE/dat/dreamland.des" "$SE/include/dreamlnd.h" "$ROOT/web/assets/brick/ascend.json"

# 2. register the port in src/windows.c and util/makedefs.c (idempotent)
python3 - "$SE" <<'EOF'
import sys
se = sys.argv[1]
p = se + '/src/windows.c'
s = open(p).read()
if 'web_procs' not in s:
    s = s.replace('#include "hack.h"\n',
        '#include "hack.h"\n#ifdef WEB_GRAPHICS\nextern struct window_procs web_procs;\n#endif\n', 1)
    s = s.replace('} winchoices[] = {\n',
        '} winchoices[] = {\n#ifdef WEB_GRAPHICS\n    { &web_procs, 0 },\n#endif\n', 1)
    open(p, 'w').write(s)
p = se + '/util/makedefs.c'
s = open(p).read()
if '3D web client' not in s:
    s = s.replace('static const char *window_opts[] = {\n',
        'static const char *window_opts[] = {\n#ifdef WEB_GRAPHICS\n\t\t"3D web client",\n#endif\n', 1)
    open(p, 'w').write(s)
EOF

# 3. configure (once)
cd "$SE"
if [ ! -f src/Makefile ] || ! grep -q "$OUT" Makefile; then
    ./configure CFLAGS="-O2 -Wno-format-overflow -fcommon" \
        --with-compression=gzip --prefix="$OUT" \
        --with-owner="$(id -un)" --with-group="$(id -gn)" \
        --disable-proxy-graphics --enable-tty-graphics >"$OUT.configure.log" 2>&1 ||
        { tail -20 "$OUT.configure.log"; exit 1; }
fi

# 4. switch the build to the web port
python3 - "$SE" "$OUT" <<'EOF'
import re, sys
se = sys.argv[1]
p = se + '/include/autoconf.h'
s = open(p).read()
if 'WEB_GRAPHICS' not in s:
    s += '\n#define HACKDIR "."\n'
    s = s.replace('#define DEFAULT_WINDOW_SYS "tty"', '#define DEFAULT_WINDOW_SYS "web"')
    s = s.replace('#define TTY_GRAPHICS', '/* web build: no tty */ #undef TTY_GRAPHICS')
    s += '\n#define WEB_GRAPHICS\n'
    open(p, 'w').write(s)
# (the game data's folder: the one it's started in (the server starts it in its slashemdir), wherever that is: a release
# unzipped anywhere, the project moved; not a path written into it when it was built)
s2 = re.sub(r'#define HACKDIR "[^"]*"', '#define HACKDIR "."', s)
if s2 != s:
    open(p, 'w').write(s2)
p = se + '/sys/share/unixtty.c'
s = open(p).read()
if 'WEB_GRAPHICS' not in s:
    s = re.sub(r'^#\s*include <curses.h>', '#ifndef WEB_GRAPHICS\n#include <curses.h>\n#endif', s, count=1, flags=re.M)
    open(p, 'w').write(s)
# Ascend's level file is part of the game data (dat/dreamland.des is generated)
p = se + '/dat/Makefile'
s = open(p).read()
if 'dreamland.des' not in s:
    s = s.replace('\ttower.des yendor.des sokoban.des\n',
                  '\ttower.des yendor.des sokoban.des dreamland.des\n\t../util/lev_comp $(srcdir)/dreamland.des\n', 1)
# (a build from before Ascend was one level also listed levels 2 to 7: drop them)
s = re.sub(r'\t\.\./util/lev_comp \$\(srcdir\)/dreamland[2-9]\.des\n', '', s)
s = re.sub(r' dreamland[2-9]\.des', '', s)
open(p, 'w').write(s)
p = se + '/Makefile'
s = open(p).read()
if 'dreamlnd.lev' not in s:
    s = s.replace('SPEC_LEVS = asmodeus.lev', 'SPEC_LEVS = dreamlnd.lev asmodeus.lev', 1)
s = re.sub(r' dreamln[2-9]\.lev', '', s)
open(p, 'w').write(s)
p = se + '/src/Makefile'
s = open(p).read()
s = re.sub(r'^WINSRC = .*$', 'WINSRC = $(srcdir)/../win/web/winweb.c tile.c', s, flags=re.M)
s = re.sub(r'^WINOBJ = .*$', 'WINOBJ = winweb.o tile.o', s, flags=re.M)
if 'winweb.o:' not in s:
    s += '\nwinweb.o: $(srcdir)/../win/web/winweb.c $(HACK_H)\n\t$(CC) $(CFLAGS) -c $(srcdir)/../win/web/winweb.c\n'
open(p, 'w').write(s)
EOF

# pre-generated parser sources (no bison/flex needed)
for f in lev_yacc.c lev_lex.c dgn_yacc.c dgn_lex.c; do
    cp sys/share/$f util/$f
done
cp sys/share/lev_comp.h sys/share/dgn_comp.h include/
touch util/*_yacc.c util/*_lex.c include/*_comp.h

mkdir -p "$OUT"
# (a parallel build can write src/monst.o twice at once, the game and the utilities each wanting it, and leave it
# corrupt but newer than its source: so before the one-at-a-time retry, it goes, to be made again)
make -j"$(nproc)" >"$OUT.log" 2>&1 || { rm -f src/monst.o; make >>"$OUT.log" 2>&1; } || { grep -n "error" "$OUT.log" | head -30; exit 1; }
KEEP=$(mktemp -d)
keep_player_data "$OUT/slashemdir" "$KEEP"
make install >>"$OUT.log" 2>&1 || { tail -30 "$OUT.log"; echo "player data kept in $KEEP"; exit 1; }
restore_player_data "$OUT/slashemdir" "$KEEP"
# every build wipes every saved game (and its block world): saves from before
# a change never mix with the new levels; scores (record, logfile) stay
rm -f "$OUT"/slashemdir/save/* "$ROOT"/worlds/*/*.json
echo "saved games wiped"
# the client's item looks go by the engine's artifact numbers (an artifact is
# sent as ART_TILE + its number: port/winweb.c), which follow the order the
# hooks add them in: list them again from this build's artifact list
python3 "$ROOT/tools/build_items.py" | tail -2
echo "built: $(ls "$OUT"/*/slashem 2>/dev/null || find "$OUT" -name slashem -type f)"

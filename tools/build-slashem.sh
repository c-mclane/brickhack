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
# the Dreamland overland level (and the client's layout for it)
python3 "$ROOT/tools/dreamland_gen.py" "$SE/dat/dreamland.des" "$ROOT/web/assets/dreamland.json" "$SE/include/dreamlnd.h"

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
    s += '\n#define HACKDIR "%s/slashemdir"\n' % sys.argv[2]
    s = s.replace('#define DEFAULT_WINDOW_SYS "tty"', '#define DEFAULT_WINDOW_SYS "web"')
    s = s.replace('#define TTY_GRAPHICS', '/* web build: no tty */ #undef TTY_GRAPHICS')
    s += '\n#define WEB_GRAPHICS\n'
    open(p, 'w').write(s)
# (the game data's folder: kept where the project is now, should it have moved)
s2 = re.sub(r'#define HACKDIR "[^"]*"', '#define HACKDIR "%s/slashemdir"' % sys.argv[2].replace('\\', '\\\\'), s)
if s2 != s:
    open(p, 'w').write(s2)
p = se + '/sys/share/unixtty.c'
s = open(p).read()
if 'WEB_GRAPHICS' not in s:
    s = re.sub(r'^#\s*include <curses.h>', '#ifndef WEB_GRAPHICS\n#include <curses.h>\n#endif', s, count=1, flags=re.M)
    open(p, 'w').write(s)
# Dreamland's level file is part of the game data (dat/dreamland.des is generated)
p = se + '/dat/Makefile'
s = open(p).read()
if 'dreamland.des' not in s:
    s = s.replace('\ttower.des yendor.des sokoban.des\n',
                  '\ttower.des yendor.des sokoban.des dreamland.des\n\t../util/lev_comp $(srcdir)/dreamland.des\n', 1)
    open(p, 'w').write(s)
if 'dreamland2.des' not in s:
    s = s.replace('\t../util/lev_comp $(srcdir)/dreamland.des\n',
                  '\t../util/lev_comp $(srcdir)/dreamland.des\n\t../util/lev_comp $(srcdir)/dreamland2.des\n', 1)
    s = s.replace('sokoban.des dreamland.des\n', 'sokoban.des dreamland.des dreamland2.des\n', 1)
    open(p, 'w').write(s)
if 'dreamland3.des' not in s:
    s = s.replace('\t../util/lev_comp $(srcdir)/dreamland2.des\n',
                  '\t../util/lev_comp $(srcdir)/dreamland2.des\n\t../util/lev_comp $(srcdir)/dreamland3.des\n', 1)
    s = s.replace('dreamland.des dreamland2.des\n', 'dreamland.des dreamland2.des dreamland3.des\n', 1)
    open(p, 'w').write(s)
if 'dreamland4.des' not in s:
    s = s.replace('\t../util/lev_comp $(srcdir)/dreamland3.des\n',
                  '\t../util/lev_comp $(srcdir)/dreamland3.des\n\t../util/lev_comp $(srcdir)/dreamland4.des\n', 1)
    s = s.replace('dreamland2.des dreamland3.des\n', 'dreamland2.des dreamland3.des dreamland4.des\n', 1)
    open(p, 'w').write(s)
if 'dreamland5.des' not in s:
    s = s.replace('\t../util/lev_comp $(srcdir)/dreamland4.des\n',
                  '\t../util/lev_comp $(srcdir)/dreamland4.des\n\t../util/lev_comp $(srcdir)/dreamland5.des\n', 1)
    s = s.replace('dreamland3.des dreamland4.des\n', 'dreamland3.des dreamland4.des dreamland5.des\n', 1)
    open(p, 'w').write(s)
if 'dreamland6.des' not in s:
    s = s.replace('\t../util/lev_comp $(srcdir)/dreamland5.des\n',
                  '\t../util/lev_comp $(srcdir)/dreamland5.des\n\t../util/lev_comp $(srcdir)/dreamland6.des\n', 1)
    s = s.replace('dreamland4.des dreamland5.des\n', 'dreamland4.des dreamland5.des dreamland6.des\n', 1)
    open(p, 'w').write(s)
if 'dreamland7.des' not in s:
    s = s.replace('\t../util/lev_comp $(srcdir)/dreamland6.des\n',
                  '\t../util/lev_comp $(srcdir)/dreamland6.des\n\t../util/lev_comp $(srcdir)/dreamland7.des\n', 1)
    s = s.replace('dreamland5.des dreamland6.des\n', 'dreamland5.des dreamland6.des dreamland7.des\n', 1)
    open(p, 'w').write(s)
p = se + '/Makefile'
s = open(p).read()
if 'dreamlnd.lev' not in s:
    s = s.replace('SPEC_LEVS = asmodeus.lev', 'SPEC_LEVS = dreamlnd.lev asmodeus.lev', 1)
if 'dreamln2.lev' not in s:
    s = s.replace('SPEC_LEVS = dreamlnd.lev', 'SPEC_LEVS = dreamlnd.lev dreamln2.lev', 1)
if 'dreamln3.lev' not in s:
    s = s.replace('SPEC_LEVS = dreamlnd.lev dreamln2.lev', 'SPEC_LEVS = dreamlnd.lev dreamln2.lev dreamln3.lev', 1)
if 'dreamln4.lev' not in s:
    s = s.replace('dreamln2.lev dreamln3.lev', 'dreamln2.lev dreamln3.lev dreamln4.lev', 1)
if 'dreamln5.lev' not in s:
    s = s.replace('dreamln3.lev dreamln4.lev', 'dreamln3.lev dreamln4.lev dreamln5.lev', 1)
if 'dreamln6.lev' not in s:
    s = s.replace('dreamln4.lev dreamln5.lev', 'dreamln4.lev dreamln5.lev dreamln6.lev', 1)
if 'dreamln7.lev' not in s:
    s = s.replace('dreamln5.lev dreamln6.lev', 'dreamln5.lev dreamln6.lev dreamln7.lev', 1)
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
make -j"$(nproc)" >"$OUT.log" 2>&1 || make >>"$OUT.log" 2>&1 || { grep -n "error" "$OUT.log" | head -30; exit 1; }
KEEP=$(mktemp -d)
keep_player_data "$OUT/slashemdir" "$KEEP"
make install >>"$OUT.log" 2>&1 || { tail -30 "$OUT.log"; echo "player data kept in $KEEP"; exit 1; }
restore_player_data "$OUT/slashemdir" "$KEEP"
# every build wipes every saved game (and its block world): saves from before
# a change never mix with the new levels; scores (record, logfile) stay
rm -f "$OUT"/slashemdir/save/* "$ROOT"/worlds/*/*.json
echo "saved games wiped"
echo "built: $(ls "$OUT"/*/slashem 2>/dev/null || find "$OUT" -name slashem -type f)"

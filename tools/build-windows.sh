#!/bin/sh
# Cross-compile BrickHack's SLASH'EM for Windows (64-bit, MinGW-w64), from the
# Linux build's patched sources (run tools/build-slashem.sh first).
#
# The game's data files (compiled levels, the dungeon, quest texts) hold
# binary structs whose layout differs between Linux and Windows, so the data
# tools (makedefs, lev_comp, dgn_comp, tilemap, dlb) are built for Windows too
# and run under Wine to make them.
#
#   build/win/src     a copy of the sources, set up for Windows
#   build/win/game    the Windows game folder: slashem.exe + its data
#
# Needs: x86_64-w64-mingw32-gcc (apt install mingw-w64), wine.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SE="$ROOT/vendor/SlashEM"
W="$ROOT/build/win"
SRC="$W/src"
GAME="$W/game"
CC="x86_64-w64-mingw32-gcc -O2 -DAUTOCONF -I../include -fcommon -w"
export WINEDEBUG=-all WINEPREFIX="$W/wine"
[ -f "$SE/include/dreamlnd.h" ] || { echo "run tools/build-slashem.sh first"; exit 1; }

# ---- 1. the sources, set up for Windows ------------------------------------
rm -rf "$SRC" "$W/obj"
mkdir -p "$SRC" "$W/obj"
(cd "$SE" && tar cf - --exclude=.git --exclude='*.o' --exclude='*.lev' .) | (cd "$SRC" && tar xf -)
cp "$ROOT/port/winweb.c" "$SRC/win/web/winweb.c"
# the Linux build's gameplay options, without the Linux-only ones; MinGW calls
# strncmpi strnicmp
sed -e '/^#define LINUX/d' -e '/^#define SYSV/d' -e '/^#define COMPRESS/d' -e '/^#define GNU_REGEX/d' \
    -e '/^#define USE_REGEX_MATCH/d' -e '/^#define MENU_COLOR/d' -e '/^#define HACKDIR/d' \
    -e '/^#define TTY_GRAPHICS/d' -e 's/^#define HAVE_DECL_STRNICMP 0/#define HAVE_DECL_STRNICMP 1/' \
    "$SE/include/autoconf.h" > "$SRC/include/autoconf.h"
cd "$SRC"
# only our web window port (no console port); on Windows config.h (not
# autoconf.h) decides, and its defaults already match the Linux build's options
sed -i 's|^#define TTY_GRAPHICS|/* #define TTY_GRAPHICS */|' include/config.h
sed -i 's|^# define DEFAULT_WINDOW_SYS "tty"|# define DEFAULT_WINDOW_SYS "web"|' include/config.h
# Windows paths written with backslashes
sed -i 's|<sys\\stat\.h>|<sys/stat.h>|; s|<sys\\types\.h>|<sys/types.h>|' src/files.c sys/share/pcmain.c
# NetHack's Protection macro is a field name in windows.h
sed -i '0,/#include <windows.h>/s//#undef Protection \/* (a NetHack macro; a field name in windows.h) *\/\n#include <windows.h>/' include/win32api.h
sed -i '0,/^#include "hack.h"/s//#include "hack.h"\n#undef Protection \/* (MinGW'"'"'s dos.h brings windows.h in early) *\//' sys/winnt/winnt.c
# stand-ins for bits of the console port the rest of the game still calls
cat > sys/winnt/webshim.c <<'SHIM'
/* BrickHack (Windows): the console port isn't built; these are what the rest
   of the game still asks of it */
#include "hack.h"
#include <string.h>
int has_color(int color) { (void) color; return 1; }
#ifdef USER_SOUNDS
void play_usersound(const char *filename, int volume) { (void) filename; (void) volume; }
#endif
/* (SLASH'EM expects the C library to have strncmpi; Windows calls it _strnicmp) */
#undef strncmpi
int strncmpi(const char *s1, const char *s2, int n) { return _strnicmp(s1, s2, n); }
SHIM

# ---- 2. the data tools (Windows programs, run under Wine) and the data -----
cd "$SRC/util"
$CC -o makedefs.exe makedefs.c ../src/monst.c ../src/objects.c ../src/alloc.c panic.c
for o in -o -p -m -z -v -f; do wine ./makedefs.exe $o; done
$CC -o lev_comp.exe lev_yacc.c lev_lex.c lev_main.c ../src/alloc.c panic.c ../src/drawing.c ../src/decl.c ../src/monst.c ../src/objects.c
$CC -o dgn_comp.exe dgn_yacc.c dgn_lex.c dgn_main.c ../src/alloc.c panic.c
$CC -o dlb.exe dlb_main.c ../src/dlb.c ../src/alloc.c panic.c
$CC -o tilemap.exe ../win/share/tilemap.c
wine ./tilemap.exe
cd "$SRC/dat"
for o in -d -r -q -h -e; do wine ../util/makedefs.exe $o; done
for f in *.des; do
    [ "$f" = template.des ] && continue
    wine ../util/lev_comp.exe "$f" > /dev/null || { echo "lev_comp failed: $f"; exit 1; }
done
wine ../util/dgn_comp.exe dungeon.pdf

# ---- 3. the game ------------------------------------------------------------
cd "$SRC/src"
OBJS=""
for f in allmain alloc apply artifact attrib ball bones borg botl cmd dbridge decl detect display do do_name \
    do_wear dog dogmove dokick dothrow drawing dungeon eat end engrave exper explode extralev files fountain \
    hack hacklib invent lock mail makemon mcastu mhitm mhitu minion mkmap mklev mkmaze mkobj mkroom mon \
    mondata monmove monst monstr mplayer mthrowu muse music o_init objects objnam options pickup pline \
    polyself potion quest questpgr pager pray priest read rect restore rip rnd role rumors save shk shknam \
    sit sounds sp_lev spell steal steed timeout topten track trap u_init uhitm vault vision vis_tab weapon \
    were wield windows wizard worm worn write zap light dlb dig teleport region tech gypsy mapglyph version tile \
    ../sys/share/pcmain ../sys/share/pcsys ../sys/share/pcunix ../sys/share/random ../sys/winnt/winnt \
    ../sys/winnt/webshim ../win/web/winweb; do
    o="$W/obj/$(basename $f).o"
    $CC -DWEB_GRAPHICS -c -o "$o" "$f.c" || { echo "compile failed: $f"; exit 1; }
    OBJS="$OBJS $o"
done
rm -rf "$GAME"
mkdir -p "$GAME/save"
x86_64-w64-mingw32-gcc -static -o "$GAME/slashem.exe" $OBJS -lwinmm

# ---- 4. its data, packed as the game expects ---------------------------------
cd "$SRC"
LISTS=$(printf 'include Makefile\nlists:\n\t@echo $(SHARE_DATDLB)\n\t@echo $(UNSHARE_DATDLB)\n' | make -s -f - lists)
SHARE=$(echo "$LISTS" | sed -n 1p)
UNSHARE=$(echo "$LISTS" | sed -n 2p)
cd dat
wine ../util/dlb.exe cf nhshare $SHARE
wine ../util/dlb.exe cf nhushare $UNSHARE
cp nhshare nhushare license "$GAME/" 2>/dev/null || cp nhshare nhushare "$GAME/"
touch "$GAME/record" "$GAME/logfile" "$GAME/perm"
echo "built: $GAME/slashem.exe"

#!/bin/sh
# Package BrickHack for Windows: build/win/BrickHack-windows.zip, a folder you
# unzip and run (BrickHack.exe). Nothing to install.
#
#   BrickHack.exe        the launcher (tools/win/launcher.c)
#   node\node.exe       a portable Node.js (the official build, checksum-checked)
#   server\  web\       the game server and the 3D client
#   game\               SLASH'EM for Windows (tools/build-windows.sh)
#
# usage: tools/package-windows.sh [--private]
#   --private  also packs your local art/ and music/ (monster sprites, the
#              skin, the tracker music: third-party files,
#              for sending to family and friends; never publish that zip)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
W="$ROOT/build/win"
NODE_VERSION=v20.20.2
NODE_ZIP=node-$NODE_VERSION-win-x64.zip
PRIVATE=0
[ "$1" = "--private" ] && PRIVATE=1
[ -f "$W/game/slashem.exe" ] || { echo "run tools/build-windows.sh first"; exit 1; }

# ---- portable Node.js (official, checksum-checked) ---------------------------
mkdir -p "$W/cache"
if [ ! -f "$W/cache/node.exe" ]; then
    curl -fsSL -o "$W/cache/$NODE_ZIP" "https://nodejs.org/dist/$NODE_VERSION/$NODE_ZIP"
    want=$(curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | grep " $NODE_ZIP\$" | cut -d' ' -f1)
    got=$(sha256sum "$W/cache/$NODE_ZIP" | cut -d' ' -f1)
    [ -n "$want" ] && [ "$want" = "$got" ] || { echo "Node.js download doesn't match its checksum"; exit 1; }
    python3 -c "
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
open(sys.argv[2], 'wb').write(z.read(sys.argv[3] + '/node.exe'))
" "$W/cache/$NODE_ZIP" "$W/cache/node.exe" "node-$NODE_VERSION-win-x64"
fi

# ---- the folder ---------------------------------------------------------------
P="$W/BrickHack"
rm -rf "$P"
mkdir -p "$P/node" "$P/worlds" "$P/music"
# the launcher (only ever next to node\ and server\, which it starts)
x86_64-w64-mingw32-gcc -O2 -s -mwindows -o "$P/BrickHack.exe" "$ROOT/tools/win/launcher.c" -lws2_32 -lshell32
cp "$W/cache/node.exe" "$P/node/"
(cd "$W/cache" && python3 -c "
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
open('node-LICENSE', 'wb').write(z.read(sys.argv[2] + '/LICENSE'))
" "$NODE_ZIP" "node-$NODE_VERSION-win-x64") && cp "$W/cache/node-LICENSE" "$P/node/LICENSE"
sh "$ROOT/tools/release-files.sh" "$P"   # the server and the client (just what the game uses)
cp -r "$W/game" "$P/game"
rm -f "$P"/game/*.NetHack-saved-game "$P"/game/web-snapshot.tmp "$P"/game/bones* "$P"/game/*.lock
if [ $PRIVATE = 1 ]; then
    cp -r "$ROOT/art" "$P/"
    cp -r "$ROOT/music/." "$P/music/"
fi
cat > "$P/README.txt" <<'TXT'
BrickHack for Windows
====================

Double-click BrickHack.exe to play. The game opens in its own window.
Close the window to stop: your game is saved.

Ascend (on the title screen) starts on a blank baseplate; Descend is the
full SLASH'EM game.

Everything stays in this folder: saved games in game\, built blocks in
worlds\. To move to a new version, copy those two folders across.

Extras you can add yourself (they aren't included):
  music\       tracker modules (.xm .mod .s3m .it ...) play in the background
  art\         custom sprites and pictures: see art\README.md
TXT

# ---- the zip --------------------------------------------------------------------
NAME=BrickHack-windows
[ $PRIVATE = 1 ] && NAME=BrickHack-windows-private
rm -f "$W/$NAME.zip"
(cd "$W" && python3 -c "
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in os.walk('BrickHack'):
        z.write(d)   # (every folder, empty or not: the game's save\\)
        for f in fs:
            z.write(os.path.join(d, f))
" "$NAME.zip")
echo "packed: $W/$NAME.zip ($(du -h "$W/$NAME.zip" | cut -f1))"

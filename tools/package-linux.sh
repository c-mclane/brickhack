#!/bin/sh
# Package BrickHack for Linux: build/linux/BrickHack-linux.zip, a folder you
# unzip anywhere and run (./BrickHack). Nothing to install.
#
#   BrickHack           the launcher (tools/linux/launcher.sh)
#   node/bin/node       a portable Node.js (the official build, checksum-checked)
#   server/  web/       the game server and the 3D client
#   build/slashem/slashemdir/   SLASH'EM (tools/build-slashem.sh), where the server looks for it
#
# usage: tools/package-linux.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
L="$ROOT/build/linux"
NODE_VERSION=v20.20.2
NODE_TAR=node-$NODE_VERSION-linux-x64.tar.xz
GAME="$ROOT/build/slashem/slashemdir"
[ -x "$GAME/slashem" ] || { echo "run tools/build-slashem.sh first"; exit 1; }

# ---- portable Node.js (official, checksum-checked) ---------------------------
mkdir -p "$L/cache"
if [ ! -f "$L/cache/node" ]; then
    curl -fsSL -o "$L/cache/$NODE_TAR" "https://nodejs.org/dist/$NODE_VERSION/$NODE_TAR"
    want=$(curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | grep " $NODE_TAR\$" | cut -d' ' -f1)
    got=$(sha256sum "$L/cache/$NODE_TAR" | cut -d' ' -f1)
    [ -n "$want" ] && [ "$want" = "$got" ] || { echo "Node.js download doesn't match its checksum"; exit 1; }
    tar -xJf "$L/cache/$NODE_TAR" -C "$L/cache" "node-$NODE_VERSION-linux-x64/bin/node" "node-$NODE_VERSION-linux-x64/LICENSE"
    mv "$L/cache/node-$NODE_VERSION-linux-x64/bin/node" "$L/cache/node"
    mv "$L/cache/node-$NODE_VERSION-linux-x64/LICENSE" "$L/cache/node-LICENSE"
fi

# ---- the folder ---------------------------------------------------------------
P="$L/BrickHack"
rm -rf "$P"
mkdir -p "$P/node/bin" "$P/worlds" "$P/music" "$P/build/slashem"
cp "$ROOT/tools/linux/launcher.sh" "$P/BrickHack"
chmod +x "$P/BrickHack"
cp "$L/cache/node" "$P/node/bin/"
cp "$L/cache/node-LICENSE" "$P/node/LICENSE"
sh "$ROOT/tools/release-files.sh" "$P"   # the server and the client (just what the game uses)
cp -r "$GAME" "$P/build/slashem/slashemdir"
rm -f "$P"/build/slashem/slashemdir/save/* "$P"/build/slashem/slashemdir/web-snapshot.tmp
: > "$P/build/slashem/slashemdir/record"; : > "$P/build/slashem/slashemdir/logfile"
rm -f "$P"/build/slashem/slashemdir/bones* "$P"/build/slashem/slashemdir/*.lock
cat > "$P/README.txt" <<'TXT'
BrickHack for Linux
===================

Run ./BrickHack to play (double-click it, or from a terminal). The game opens
in a window of its own if you have Chrome, Chromium, Brave or Edge; otherwise
in your web browser, at http://127.0.0.1:18081/.
Close the window to stop: your game is saved.

Ascend (on the title screen) starts on a blank baseplate; Descend is the
full SLASH'EM game.

Everything stays in this folder: saved games in build/slashem/slashemdir/save,
built blocks in worlds/. To move to a new version, copy those across.

Extras you can add yourself (they aren't included):
  music/       tracker modules (.xm .mod .s3m .it ...) play in the background
  art/         custom sprites and pictures: see art/README.md

Needs a 64-bit (x86-64) Linux with glibc 2.36 or newer (Debian 12, Ubuntu
22.10 and later, Fedora 37 and later...).
TXT

# ---- the zip --------------------------------------------------------------------
NAME=BrickHack-linux
rm -f "$L/$NAME.zip"
(cd "$L" && python3 - "$NAME.zip" <<'PY'
import os, stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in os.walk('BrickHack'):
        z.write(d)   # (every folder, empty or not: the game's save/)
        for f in fs:
            p = os.path.join(d, f)
            i = zipfile.ZipInfo.from_file(p)   # (keeps the launcher, node and the game executable)
            i.compress_type = zipfile.ZIP_DEFLATED
            with open(p, 'rb') as fh:
                z.writestr(i, fh.read())
PY
)
echo "packed: $L/$NAME.zip ($(du -h "$L/$NAME.zip" | cut -f1))"

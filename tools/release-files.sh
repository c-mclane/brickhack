#!/bin/sh
# What a release carries of the game itself, into folder $1 (tools/package-linux.sh, tools/package-windows.sh): the
# server, the 3D client with the models the game uses (not the build's leftovers: the .ldr and .key files, the test
# dungeon's scene parts in cache/, outfits made on this machine in custom/, local music), the licences, and the art
# folder's own files (its layout and notes; never local sprites or music: third-party files)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
P="$1"
(cd "$ROOT" && tar cf - --exclude='*.ldr' --exclude='*.key' --exclude='web/assets/brick/cache' --exclude='web/assets/brick/custom' \
    --exclude='web/music/*' --exclude='web/assets/tilesets/absurd' --exclude='web/assets/brick/scene*' --exclude='web/baseplate.html' server web) | (cd "$P" && tar xf -)
cp "$ROOT/LICENSE" "$ROOT/LICENSE.NetHack" "$P/"
(cd "$ROOT" && git ls-files art | tar cf - -T -) | (cd "$P" && tar xf -)

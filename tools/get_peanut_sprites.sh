#!/bin/sh
# Download the Kirby Super Star Ultra sprites (the Peanut Plains enemies, and
# Kirby himself, at the Fountain of Dreams) from
# WiKirby's gallery (wikirby.com/wiki/Kirby_Super_Star_Ultra/gallery) into
# art/monsters/ (local only: git ignores art/), where MineHack shows them in
# 3D for the matching monsters (mods/monsters/*.json). One at a time.
# Reload the game page afterwards; no rebuild needed.
set -e
cd "$(dirname "$0")/../art/monsters"
echo "art/monsters:"
while read name url; do
  curl -fsSL -A "MineHack sprite fetch" -o "$name.png" "$url" && echo "  $name.png"
  sleep 1
done <<'LIST'
Bomber https://cdn.wikirby.com/c/cd/KSSU_Bomber_Sprite.png
Noddy https://cdn.wikirby.com/0/0d/KSSU_Noddy_Sprite.png
Bronto-Burt https://cdn.wikirby.com/c/c5/KSSU_Bronto_Burt_Sprite.png
Parasol-Waddle-Dee https://cdn.wikirby.com/7/7c/KSSU_Parasol_Waddle_Dee_Sprite.png
Broom-Hatter https://cdn.wikirby.com/7/75/KSSU_Broom_Hatter_Sprite.png
Poppy-Bros-Jr https://cdn.wikirby.com/1/18/KSSU_Poppy_Bros_Jr_Sprite.png
Gordo https://cdn.wikirby.com/b/b6/KSSU_Gordo_Sprite.png
Sir-Kibble https://cdn.wikirby.com/2/24/KSSU_Sir_Kibble_Sprite.png
Grizzo https://cdn.wikirby.com/1/10/KSSU_Grizzo_Sprite.png
Waddle-Dee https://cdn.wikirby.com/8/8c/KSSU_Waddle_Dee_Sprite.png
Kabu https://cdn.wikirby.com/1/1a/KSSU_Kabu_Sprite.png
Waddle-Doo https://cdn.wikirby.com/8/87/KSSU_Waddle_Doo_Sprite.png
Lovely https://cdn.wikirby.com/9/95/KSSU_Lovely_Sprite.png
Chef-Kawasaki https://cdn.wikirby.com/f/f9/KSSU_Chef_Kawasaki.png
Kirby https://cdn.wikirby.com/e/ec/KSSU_Kirby_Sprite.png
LIST

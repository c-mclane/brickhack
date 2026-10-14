# Tilesets

`build_tileset.py <name>` draws SLASH'EM's tiles in another style, as
`web/assets/tilesets/<name>/tiles.png` + `tiles.json` (the same tile numbers,
32px or bigger). Players pick one under Options > Tileset. MineHack's own
monsters (`mods/monsters`, like the Kirby crew) always keep their own art.

| name     | looks like                     | where its tiles come from                                    |
|----------|--------------------------------|--------------------------------------------------------------|
| `dcss`   | Dungeon Crawl Stone Soup       | RLTiles' 32px NetHack set, then DCSS's art (both public domain / CC0) |
| `absurd` | the Absurd tileset             | your own copy (it has no licence to share: it stays local)    |

What NetHack 3.4.3 doesn't have (SLASH'EM's extra monsters and items) keeps
SLASH'EM's own tile, scaled up.

## The sources (under `vendor/`, not tracked)

```bash
mkdir -p vendor/tilesets/rltiles-nh32 vendor/tilesets/nethack343
curl -L -o /tmp/nh32.zip https://rltiles.sourceforge.net/nh32.zip   # unzip nh32.bmp into vendor/tilesets/rltiles-nh32/
curl -L https://www.nethack.org/download/3.4.3/nethack-343-src.tgz | tar xz -C /tmp
cp /tmp/nethack-3.4.3/win/share/{monsters,objects,other}.txt vendor/tilesets/nethack343/
git clone --depth 1 https://github.com/crawl/crawl vendor/crawl
```

For `absurd`, put its NetHack 3.4.3 tile sheet in `art/tilesets/` as
`absurd*.png` (any tile size; it's drawn at up to 64px). Neither that sheet nor
the built `web/assets/tilesets/absurd/` goes in git or the public Windows zip.

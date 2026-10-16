# Custom art

Drop-in art that changes how BrickHack looks. Everything in these folders stays
on your machine. Git ignores the images (only this README, the monster list
and the folder markers are tracked), so third-party art never ends up in
the public repo.

| Folder | What goes in it | Used as |
| --- | --- | --- |
| `skins/` | `steve.png`: the default 64x64 player skin | the player model when a character has no skin of its own |
| `blocks/` | `<block>.png`, e.g. `leaves.png` (from a texture pack) | replaces that block's texture (16x16; bigger is scaled down); `leaves.png` covers all three leaf variants; a name that isn't a block texture is skipped with a console warning |
| `monsters/` | `<monster name>.png` | the 3D look of that monster: an existing one, or a custom monster from `mods/monsters/` (made with `npm run monster`, see the main README) |

## Monster sprites

- **Naming:** name the file after the SLASH'EM monster it replaces. Every name
  is listed in [`monsters/MONSTERS.txt`](monsters/MONSTERS.txt). Use `-` or
  `_` in place of spaces if you like, so these all work:
  - `jackal.png`
  - `gnome lord.png`
  - `gnome-lord.png`
- **Formats:** PNG, GIF (first frame) or WebP. Transparent backgrounds work.
- **Size:** the sprite keeps its resolution, up to 64x64. Small pixel art is
  scaled up by a whole number so it stays crisp, and feet sit on the ground.
  How tall the creature stands still comes from the monster's size in the
  game (a jackal is small, a dragon is huge).
- **Reloading:** reload the page to pick up new or changed files. A file whose
  name doesn't match a monster is skipped, with a warning in the browser
  console.

The game rules don't change. A sprite only changes what you see, so a dragon
drawn over a jackal still fights like a jackal.

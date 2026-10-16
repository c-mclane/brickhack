# BrickHack

SLASH'EM 0.0.8E0F2 (github.com/k21971/SlashEM, the hardfought.org tree, built on
NetHack) played as a 3D world of toy bricks. The real game engine runs
underneath, with small hooks added for what the 3D world needs; every rule,
monster and item is the game's own.

## What it is

- **Brick figures.** Every role and race is a buildable brick figure, designed
  piece by piece: its head, hair, torso print, legs and accessories. Armour
  is real attachments (shoulder plates, helmets, capes, boots, gloves) rather
  than prints, and what a figure is built wearing is exactly its starting
  gear.
- **Brick items.** Food, potions, gems, coins, rings, armour and weapons are
  small brick builds. Potions take their shape and colour from their
  (shuffled) appearance, so an unidentified potion looks like what it is
  called, not what it does.
- **Metal that shines.** Gold and chrome pieces reflect a sky-to-ground
  gradient.
- **Physics.** Thrown things fly in an arc, bounce and tumble to rest;
  monsters' throws fly the same way. Glass shatters into shards, and potions
  splash.
- **Artifact effects.** Some artifacts glow, crackle with lightning, burn,
  glitter with frost or throw off little meteors.
- **A faith of its own.** The clerical figures (priests, a bishop and the
  monks) follow Jesus, a lawful god, with an introduction of their own. They
  start with holy wafers and holy wine in a chalice, pray anywhere, and have
  their own rites at his altar: Mass, Communion, alms and confession. Only
  his followers can use them.
- **Smooth movement.** When you step, every creature eases to its next square
  and arrives as you do.
- **Combat feedback.** Your weapon is in your hand and swings when you attack.
  Monsters flinch, dodge and burst into smoke; getting hurt shakes the screen
  and shows the damage.
- **Recommended actions.** A pane above the hotbar suggests what to do right
  now: pray when your HP is very low, eat when hungry, open a door or chest
  next to you, use the stairs or altar you're on, pick up what's here. Press
  the up arrow for the first, or click any.
- **Actions.** The inventory's Actions tab has every command as a button,
  grouped (Move & fight, Items, Magic & gods, Interact, Info), plus a list of
  every extended command.

## Descend and Ascend

The title screen has two ways to play:

- **Descend:** classic SLASH'EM, from level 1 of the Dungeons of Doom.
- **Ascend:** a blank green baseplate under a blue sky, with nothing on it
  yet: a starting point for building levels of your own
  (`tools/dreamland_gen.py` writes it).

## Races

Besides SLASH'EM's own races, BrickHack adds two:

- **Quantum:** born of a quantum mechanic. You teleport at random, from the
  very start.
- **Angel:** you fly, and see invisible, from the start.

## Controls

| Key | Action |
| --- | --- |
| Mouse | look |
| W A S D (+Shift) | move / rush, relative to the camera (8 directions) |
| Left click | attack toward the crosshair |
| Right click | use held item, open/close a door, travel to the spot |
| Middle click | look at what's under the crosshair |
| 1-9 / wheel | hotbar |
| I | inventory, with its Actions tab |
| Delete / Shift+Delete | drop one / drop the stack of the held item |
| Space | stairs if you're on them, else search |
| Shift+1..4 | the Recommended actions, row 1 to 4 |
| Up arrow | the first Recommended action |
| Enter | command bar (extended commands, dev commands) |
| Every other key | NetHack's own, as ever: `e` eat, `q` quaff, `r` read, `z` zap, `t` throw, `,` pick up, `#` extended command, `P` put on, Alt+I invoke, Ctrl+D kick... |
| Tab | message history |
| F2 / F5 / F1 / F3 | overhead map / camera / hide HUD / debug info |
| \` | raw NetHack keys on/off (W A S D too) |
| Esc | cancel prompt / game menu |

## Dev commands

Press Enter in a game to open the command bar, then:

- `give <item>`: puts the item in your inventory. Name it the way you'd wish
  for it (`give blessed +3 silver dragon scale mail`, `give 20 melons`).
- `tp <level>`: straight to that level of the dungeon you're in.

**Every build wipes all saved games**, so a save never mixes with changed
levels. Scores are kept. **Reset Game...** on the title screen deletes every
saved character and any bones, after asking.

## Adding a monster

New creatures are real SLASH'EM monsters. Each copies every stat, attack and
behaviour of an existing monster and gets its own name, tile and sprite:

```bash
npm run monster -- "Name" monkey ~/Downloads/sprite.png
```

This writes `mods/monsters/<name>.json` (the definition and a 16x16 tile,
committed) and the full-size sprite in `art/monsters/` (local only).
`mods/monsters/template-monster.json` is a blank example to copy: a monkey
with an empty tile, never generated. Rebuild
and restart the server. Add `"nogen": true` to keep it out of random
generation. Adding or removing a monster changes the save format.

## Tilesets

Options > Tileset redraws the sprites: SLASH'EM's own 16px tiles, a 32px
public-domain set, or one you build yourself from your own copy
([tools/tilesets/README.md](tools/tilesets/README.md)).

## How it works

```
browser (WebGL2 + DOM HUD)  <-- SSE / POST -->  server/server.js  <-- pipes -->  slashem
                                                                   stdin: commands
                                                                   fd 3: JSON events
```

`port/winweb.c` is a window port compiled into SLASH'EM. Instead of drawing a
terminal it streams map glyphs, visibility, status, inventory, menus and
prompts as JSON lines, and reads keys, clicks and menu picks from stdin.
`tools/patch_engine.py` adds the hooks to the game core; `tools/add_monsters.py`
adds the custom monsters. The brick figures and items are built from text
designs by the Python tools in `tools/` into glTF models. Closing the tab
saves the game.

## Build & run

Needs gcc, make, python3 and node (no npm packages), and the open-source brick
parts library unzipped into `vendor/ldraw/`.

```bash
npm run build   # clones + builds SLASH'EM into build/, the tile atlas and the brick models
npm start       # http://127.0.0.1:8081/
```

To let others on your network play:

```bash
HOST=0.0.0.0 npm start   # then they open http://<your-ip>:8081/
```

Each browser tab is its own game. Saves go by character name, so everyone
needs a different one.

## License

The original code in this repository (the web client, server and tools) is
licensed under the GNU General Public License v3.0 (see `LICENSE`).

NetHack and SLASH'EM are distributed under the NetHack General Public License
(see `LICENSE.NetHack`). The window port in `port/` is compiled into those
games and the tile atlases in `web/assets/` are generated from their tile
sets, so those parts are covered by the NetHack General Public License.

BrickHack is an independent fan project. It is not affiliated with, sponsored
or endorsed by any toy or game company.

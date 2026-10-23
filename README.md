<div align="center">

# BrickHack

### SLASH'EM, the whole of it, built in toy bricks.

Every monster, every item, every trap, every corner of the dungeon: a brick build you can walk around,<br>
with the real game engine running underneath.

<br>

[![Release](https://img.shields.io/github/v/release/c-mclane/brickhack?style=for-the-badge&color=f2c200&label=release)](https://github.com/c-mclane/brickhack/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/c-mclane/brickhack/total?style=for-the-badge&color=e3000b)](https://github.com/c-mclane/brickhack/releases)
[![License](https://img.shields.io/github/license/c-mclane/brickhack?style=for-the-badge&color=0055bf)](LICENSE)
[![Stars](https://img.shields.io/github/stars/c-mclane/brickhack?style=for-the-badge&color=237841)](https://github.com/c-mclane/brickhack/stargazers)

[![Last commit](https://img.shields.io/github/last-commit/c-mclane/brickhack?style=flat-square)](https://github.com/c-mclane/brickhack/commits/main)
[![Commits](https://img.shields.io/github/commit-activity/t/c-mclane/brickhack?style=flat-square&label=commits)](https://github.com/c-mclane/brickhack/commits/main)
[![Commit activity](https://img.shields.io/github/commit-activity/m/c-mclane/brickhack?style=flat-square)](https://github.com/c-mclane/brickhack/pulse)
[![Repo size](https://img.shields.io/github/repo-size/c-mclane/brickhack?style=flat-square)](https://github.com/c-mclane/brickhack)
[![Top language](https://img.shields.io/github/languages/top/c-mclane/brickhack?style=flat-square)](https://github.com/c-mclane/brickhack)
[![Issues](https://img.shields.io/github/issues/c-mclane/brickhack?style=flat-square)](https://github.com/c-mclane/brickhack/issues)

[![Engine](https://img.shields.io/badge/engine-SLASH'EM%200.0.8E0F2-8a2be2?style=flat-square)](https://github.com/k21971/SlashEM)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20Windows%20%7C%20browser-555?style=flat-square)](#build--run)
[![Node](https://img.shields.io/badge/node-20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![three.js](https://img.shields.io/badge/three.js-r160-000?style=flat-square&logo=three.js&logoColor=white)](https://threejs.org)
[![WebGL2](https://img.shields.io/badge/WebGL-2-990000?style=flat-square&logo=webgl&logoColor=white)](#how-it-works)
[![npm deps](https://img.shields.io/badge/npm%20dependencies-0-brightgreen?style=flat-square)](#build--run)

[![Monsters](https://img.shields.io/badge/monsters%20in%20brick-632%20%2F%20634-f2c200?style=flat-square)](#the-menagerie)
[![Hallucinations](https://img.shields.io/badge/hallucinations-100-ff69b4?style=flat-square)](#the-menagerie)
[![Items](https://img.shields.io/badge/items%20in%20brick-488-0055bf?style=flat-square)](#what-it-is)
[![Traps](https://img.shields.io/badge/traps-22%20%2F%2022-e3000b?style=flat-square)](#the-dungeon)
[![Castle](https://img.shields.io/badge/the%201978%20castle-544%20bricks-c9a227?style=flat-square)](#ascend-the-golden-castle)

<br>

<img src="docs/shots/ascend-knight.jpg" alt="A knight on his pony before the golden castle on Ascend's meadow" width="820">

<sub><i>Ascend: a knight and his pony before the golden castle, the king's enemies coming out of the woods.</i></sub>

<br><br>

**[Download](https://github.com/c-mclane/brickhack/releases/latest)** &nbsp;·&nbsp;
[Gallery](#gallery) &nbsp;·&nbsp;
[What it is](#what-it-is) &nbsp;·&nbsp;
[Descend and Ascend](#descend-and-ascend) &nbsp;·&nbsp;
[Controls](#controls) &nbsp;·&nbsp;
[Build & run](#build--run)

</div>

---

SLASH'EM 0.0.8E0F2 (github.com/k21971/SlashEM, the hardfought.org tree, built on
NetHack) played as a 3D world of toy bricks. The real game engine runs
underneath, with small hooks added for what the 3D world needs; every rule,
monster and item is the game's own.

## Gallery

### Ascend: the golden castle

<table>
<tr>
<td width="50%"><img src="docs/shots/ascend-meadow.jpg" alt="Ascend's meadow"><br><sub><b>The meadow.</b> Ringed by woods, the castle in its north, its drawbridge down. The king's enemies are already on the grass.</sub></td>
<td width="50%"><img src="docs/shots/castle.jpg" alt="The golden castle"><br><sub><b>The castle.</b> The yellow castle of 1978, laid brick by brick in its instruction book's order, in chrome gold.</sub></td>
</tr>
</table>

### Heroes

<table>
<tr>
<td width="33%"><img src="docs/shots/title.jpg" alt="Title screen"><br><sub><b>The title screen.</b> Descend into the Dungeons of Doom, or Ascend to the meadow.</sub></td>
<td width="33%"><img src="docs/shots/create.jpg" alt="Character creation"><br><sub><b>Character creation.</b> Every role and race a buildable figure; what it's built wearing is its starting kit.</sub></td>
<td width="33%"><img src="docs/shots/archer.jpg" alt="An archer drawing his bow"><br><sub><b>Combat.</b> The bow drawn and loosed before the game moves on; the arrow flies in an arc.</sub></td>
</tr>
<tr>
<td><img src="docs/shots/centaur.jpg" alt="A plains centaur archer"><br><sub><b>Riders and archers.</b> A plains centaur, bow in hand.</sub></td>
<td><img src="docs/shots/wizards.jpg" alt="Four wizards"><br><sub><b>Four wizards.</b> The Wizard of Yendor himself, and three you can play: Daggorath, all in black under his moon, and two old friends in grey and white.</sub></td>
<td><img src="docs/shots/yendor.jpg" alt="The Wizard of Yendor"><br><sub><b>The Wizard of Yendor.</b> His magenta @ on cape, chest and hat, his one red eye, his aura.</sub></td>
</tr>
</table>

### The menagerie

<table>
<tr>
<td colspan="3"><img src="docs/shots/menagerie.jpg" alt="The whole menagerie"><br><sub><b>Everyone.</b> 632 of SLASH'EM's 634 monsters (the other two are placeholders), plus all 100 of the names you see when you're hallucinating.</sub></td>
</tr>
<tr>
<td width="33%"><img src="docs/shots/balrog.jpg" alt="The Balrog on fire"><br><sub><b>The Balrog,</b> in flame and smoke.</sub></td>
<td width="33%"><img src="docs/shots/chromatic.jpg" alt="The Chromatic Dragon"><br><sub><b>The Chromatic Dragon,</b> five heads, an angel's aura.</sub></td>
<td width="33%"><img src="docs/shots/dragons.jpg" alt="Dragons"><br><sub><b>Dragons,</b> every colour of them.</sub></td>
</tr>
<tr>
<td><img src="docs/shots/worms.jpg" alt="Long worms and purple worms"><br><sub><b>Long worms,</b> segment by segment, across the squares they fill.</sub></td>
<td><img src="docs/shots/basilisk.jpg" alt="The basilisk"><br><sub><b>The basilisk,</b> full size, two silver fangs.</sub></td>
<td><img src="docs/shots/owlbear.jpg" alt="An owlbear"><br><sub><b>An owlbear.</b></sub></td>
</tr>
<tr>
<td><img src="docs/shots/mines.jpg" alt="The Gnomish Mines"><br><sub><b>The Gnomish Mines,</b> its gnomes and dwarves on their brown rock.</sub></td>
<td><img src="docs/shots/kops.jpg" alt="Keystone Kops"><br><sub><b>The Keystone Kops,</b> after you for shoplifting.</sub></td>
<td><img src="docs/shots/gargoyle.jpg" alt="A winged gargoyle"><br><sub><b>A winged gargoyle.</b></sub></td>
</tr>
<tr>
<td><img src="docs/shots/gollum.jpg" alt="Gollum"><br><sub><b>Hallucinating:</b> a familiar face.</sub></td>
<td><img src="docs/shots/turtles.jpg" alt="Ninja turtles"><br><sub><b>Hallucinating:</b> heroes in a half shell.</sub></td>
<td><img src="docs/shots/spider.jpg" alt="A weresnake and a werespider"><br><sub><b>A weresnake and a werespider,</b> one of them friendly-ish.</sub></td>
</tr>
</table>

### The dungeon

<table>
<tr>
<td width="100%"><img src="docs/shots/traps.jpg" alt="Traps"><br><sub><b>Traps,</b> all 22 of them, each its own build: bear traps, landmines, rust traps, pits and holes dug into the floor, webs, magic traps, level teleporters...</sub></td>
</tr>
</table>

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
- **Wands and spells.** Every zap and every spell plays out before the game
  answers it, with its own sound: bolts of fire, frost and lightning, a magic
  missile's blast, sleep's soft glide, death's black ray, hearts for healing,
  streams and swirls of bricks, the wand raised (and no wand at all for a
  plain cast). Gas spores and other exploding monsters go up in a burst.
- **The dungeon.** Dark rooms are dark till you light them; each area has its
  own colours (Sokoban blue, Gehennom red, Fort Ludios gold, the Wizard's
  Tower purple...). Thrones, graves, trees, iron bars, ladders, ice, the
  Elemental Planes, a drawbridge that swings on its hinge; what's written on
  the floor drawn there in its own hand, and scuffed to ?s as you walk over
  it; swallowed, the creature's insides closing round you.
- **Actions.** The inventory's Actions tab has every command as a button,
  grouped (Move & fight, Items, Magic & gods, Interact, Info), plus a list of
  every extended command.

## Descend and Ascend

The title screen has two ways to play:

- **Descend:** classic SLASH'EM, from level 1 of the Dungeons of Doom.
- **Ascend:** sent out by the old king on a quest to become the greatest
  warrior the land has known. A wide meadow of baseplate green under a clear
  blue sky, ringed by woods, and in its north his castle: the yellow castle of
  1978, every brick laid in the order its instruction book lays them, in
  chrome gold (`tools/castle375.py`), its drawbridge down before you. His
  enemies are out on the meadow, orcs and goblins, kobolds and wolves, and
  however many you strike down, more come out of the woods
  (`tools/dreamland_gen.py` writes the level).

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

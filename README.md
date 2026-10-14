# MineHack

SLASH'EM 0.0.8E0F2 (github.com/k21971/SlashEM, the hardfought.org tree, built on
NetHack) running as a Minecraft-style 3D world. The real game engine runs
unchanged underneath, plus a few small hooks for building.

- **Look:** the walls are 4-block brick columns with the game's battlement tile on
  top. Corridors are tunnels cut through stone. Creatures are upright sprites
  of the game's tiles, scaled by size.
- **Movement:** smooth. When you step, every creature eases to its next square
  and arrives as you do.
- **Player:** a Minecraft-style player model using any 64x64 Minecraft skin (put
  a default in `skins/steve.png`; load your own from Options or the character
  creator). Alternatively a game-tile sprite, or a custom 16x16 skin made from
  any picture.
- **Building:** every character starts with a pick-axe and no blocks: every
  block you build with is one you mined.
  - Right-click to place, hold left-click to break. A broken block pops out as
    itself (stone gives stone, logs give logs, planks give planks...): a little
    spinning block on the ground. Walk over it to pick it up. A dungeon wall
    dug through with the pick-axe drops a brick block, solid rock cobblestone.
  - Space jumps. Climb onto blocks and over walls into other rooms.
  - Look straight down and place a block: it goes under your feet and lifts
    you onto it, so you can tower up without jumping. In the map view
    (M), right-clicking with a block does the same, a block a click; and
    holding left-click mines the first block ahead of you, the way you face,
    up to 4 squares off.
- **Autumn:** the trees wear orange-poplar autumn leaves, and leaves drift
  down from the canopies near you, swaying as they fall, then settle on the
  ground and fade.
- **Mist:** every Ascend map has mist round its edge, wisps drifting in front
  of the tree line, thickening into dense fog beyond the edge.
  - Fall more than 3 blocks and you take damage.
  - Monsters can't walk through your blocks, and ground monsters can't reach you
    2+ blocks up.
- **Mining:** hold left-click on a wall with the pick-axe for the game's own
  digging, with a block-cracking animation.
- **Chests:** chests and boxes are chest blocks. Right-click one to open a
  Minecraft-style chest screen.
- **Pickup:** everything is picked up automatically.
- **Actions:** the on-screen Actions button, or I, opens every command as a
  button. It's grouped into Here, Move & fight, Items,
  Magic & gods, Interact and Info, plus an "All commands" list, so you never
  need to hunt for keys.
- **Combat feedback:**
  - Your wielded weapon is shown in your hand (bottom-right in first person,
    in the player model's fist in third person) and jabs when you attack.
  - Enemies hop back with a white flash when hit, sidestep with a floating
    "Miss" when you miss, burst into smoke when killed, and lunge at you when
    they hurt you.
  - Getting hurt shakes the screen, rakes claw slashes across it, flashes the
    edges red and pops up a damage number. Healing shows a green +N.
- **Recommended:** a pane above the hotbar suggests what to do right now:
  - Pray when your HP is very low, and eat when you're hungry.
  - Open or kick a chest next to you, untrap an adjacent trap, open or kick a
    door.
  - Use stairs, altars, fountains and thrones under you, or pick up items.

  Click a suggestion or press Shift+1..4. Directions are filled in for you.
- **Cameras:** first person, third person back and front (F5), and an overhead
  map (M).
- **HUD and inventory:** a Minecraft HUD and inventory. Equipment slots,
  drag & drop, a hotbar, and the inventory opens as a picker for
  "What do you want to...?" prompts.
- **Saving:** your builds are saved per level and per character in `worlds/`.
- **Sky:** a procedural, animated galaxy sky, inspired by Kirby's Milky Way
  Wishes. It has purple dream-space, drifting purple, green and yellow
  nebulae, slowly turning spiral galaxies, twinkling sparkle stars and the
  occasional shooting star. The stars are pixel-art sprites modelled on the
  Kirby sky sheet: fat five-point stars with white centres and glow halos,
  in pink, green, yellow, white and red. Each star pops in, twinkles, grows
  and shrinks, spins and flashes, then shrinks away or explodes into pixel
  sparks, and reappears elsewhere. There are also four-point twinkles,
  blinking pixel dust and faint dotted swirls. A shader draws it all, with
  no images.

## Descend and Ascend

The title screen has two ways to play:

- **Descend:** classic SLASH'EM. You start on level 1 of the Dungeons of Doom.
- **Ascend:** a SLASH'EM game that begins above ground, under a happy blue
  daytime sky (the map is 120x64). You create your character as usual and
  get a story: your God sends you on a divine trial, to prove you're the most
  powerful warrior in the universe. Combat, items and everything else are
  SLASH'EM's own. The down stairs lead into the Dungeons of Doom.

In Ascend the dungeon is **Dreamland**, and you climb up through it.
`tools/dreamland_gen.py` writes its levels at build time (inside the engine
it's the "dreamland" option, levels `dreamlnd` and `dreamln2` to `dreamln7`).

Dreamland, level 1:

- **The plain:** open grass in the middle, little flowers all over it, a few
  shrubs here and there (the game's own little tree tile; some in the house's
  yard) and some rocks (cobblestone, for mining). No monsters out here.
- **The woods:** all round the edge, thin in places and deep in others: big
  Minecraft trees (log trunks, leaf canopies) packed close, a solid wall of
  tall weeds and grass between them, and a fallen log here and there. The level starts fully
  mapped, so the trees hide nothing (or almost nothing).
- **The house:** you start inside a little wood house on the plain, by a
  Minecraft tree: log corners, plank walls with glass windows, a front door
  (closed, not locked), a sloped red
  shingle roof, a brick chimney puffing smoke and a stone fireplace with a real
  fire. The stair you start on goes down: taking it leaves the game, as the up
  stairs on the Dungeons' first level do.
- **The paddock:** your pet (a Knight's pony, a kitten, a little dog...)
  starts in a fenced paddock by the house. Fences are too tall to jump and
  there's no gate: the only way out is to break the log panel in the south
  fence.
- **The castle tower:** (a soldier ant waits inside) 16 blocks of stone bricks, in a clearing in the deep
  woods to the north-east, a dirt path winding from its door out of the woods
  and across the plain to the house's front door. It has a
  doorway, arrow slits low and high, and a ladder inside (walk into it to
  climb) up to a battlemented roof. On the roof floats a glowing, swirling
  **portal**: step into it to go up to Dreamland level 2, the forest glade. Floors inside the house and the tower are dungeon
  floor.
- **Safe up high:** standing 2 or more blocks up (the tower roof, a wall top,
  a block tower you build), nothing can hurt you: no melee, missiles, breath,
  spells, gazes or wands.
- **Water:** Ascend heroes can swim, and swim on the surface: no underwater
  view, nothing gets wet.
- **The horizon:** `art/sky/dreamland-horizon.*` wraps round the sky (see
  `art/README.md`); below the horizon it's grass green.

Dreamland, level 2: a **forest glade**. The woods fill the whole map, big
trees, a wall of tall weeds, fallen logs, with a dirt path carved through
from where you arrive in the south. Glades open off it, NetHack-overland
style: a pond, an open meadow and two fenced meadows (break the log panel in
a fence to get in). Only five easy monsters (a pony, a jackal, a giant rat,
a coyote, a fox): the level to find your feet and level up a little. At the
far end, a clearing with a
ring of standing stones, trilithons round a horseshoe of taller ones, and
the portal among them: up to level 3.

Dreamland, level 3: an 8x8 grassy platform floating in the open sky, a star
block on each corner and two Waddle Dees on it. Step off the edge and you fall
into the sky, until Dreamland puts you back on the platform (gently, with a
funny message). The Waddle Dees won't walk off. Defeat both and a portal opens
in the middle of the platform, up to level 4.

Dreamland, level 4: a strange Kirby-style grass field ringed by a wall of tall
weeds (no trees), little flowers all over the grass. Peach pillars with rounded tops (a ladder up each, some with
pink brick ledges), pink-and-green checkered towers, sky-blue platforms floating
overhead with ladders up to them, little grass mounds, star-block walls with a
bomb block in each, one of every Kirby enemy (Chef Kawasaki too; Lovely: four
of them), spread far
apart and a few of them up on the towers and pillars (they stay up there), and
food lying about. The portal up is hidden somewhere.

Kirby touches all through Dreamland:

- **Food heals you.** Eating anything in Dreamland restores hit points, and a
  melon is a Maxim Tomato: it heals you completely.
- **Bomb blocks.** Break one and every star or bomb block joined to it blows
  away too (they all drop to the ground for you to pick up).

Dreamland, level 5: a white marble palace in formal gardens. In the middle,
a temple (flat roof, no steeple) with stained glass in the nave and the chancel
and a clerestory above the wings; inside, the altar stands in the middle of the
floor ringed by water (swim to it), a flame burning on either side. A west and
an east wing open off it, each with a porch of quartz pillars. A hedge maze in
each corner of the gardens (three blocks tall, a marble archway on quartz
pillars at the way in, a fountain in the middle and a Maxim Tomato beside it),
reflecting pools and a marble walk to the south, flowers everywhere, a wall of
tall weeds round it all. Two
cherubs guard it (they leave no corpse, and only a +2 or better weapon hurts
them), along with lesser garden creatures (which do leave corpses). Offer anything on the altar, whatever the gods make of it, and a portal
shimmers open in one of the hedge mazes (a different one each game), beside
its fountain: up to level 6.

Dreamland, level 6: the **Fountain of Dreams**. Step through level 5's portal
and the daylight is gone: it's night again, the stars all round you, above
and below. A round island floats among them: a grass ring round a pool that
shimmers through the rainbow, and in the middle a quartz fountain, three
tiers high, the Star Rod flashing on top. Iridescent water spills from its
bowls, and over the island's edge (a wall of arched windows) down into the
stars; four gushers leap up out of the pool round it, throwing rainbow
sparkles. Lavender towers, little red and green cone trees, star blocks,
fluffy pink clouds swirling round it all, and Kirby himself waiting across the
pool (a deep one at heart; `npm run peanut-sprites` fetches his sprite too).
Fall off and Dreamland puts you back.

It's a **trial**: defeat Kirby and, with a *pop*, the **Star Rod** flies off
the top of the fountain and lands on the grass, yours to take: a wand with 5
charges (rechargeable) that fires a beam of stars, obliterating every
monster in its path (nothing left behind). After a pause (and maybe some food
tumbling down onto the grass) two Waddle Doos float up over the edge; then a
cherub descends; then Kirby comes back, angry. Beat him again and a portal
opens somewhere on the island (a different spot each game): up to level 7.

Dreamland, level 7: level 5's palace and gardens again, but at night, under
the same starry sky, and a battle: 87 NetHack monsters spread through the
gardens, lots of ordinary ones (jackals, kobolds, orcs, gnomes...), harder
ones (soldiers, an ogre, an owlbear, a troll, a hill giant, a baby red
dragon...) and strange ones (floating eyes, nymphs, leprechauns, a
gelatinous cube, quantum mechanics, a chickatrice...). A chance to level up.

The client builds the scenery (house, paddock, tower, portal, trees) as
blocks from the layout in `web/assets/dreamland.json`; only your changes to it
are saved.

The Kirby enemies in `mods/monsters/` (Bomber, Noddy, Bronto Burt, Parasol
Waddle Dee, Broom Hatter, Poppy Bros. Jr., Gordo, Sir Kibble, Grizzo, Waddle
Dee, Kabu, Waddle Doo, Lovely, Chef Kawasaki, Kirby) are real SLASH'EM monsters that
are never randomly generated, so they only appear where a special level
places them; none does right now. `npm run peanut-sprites` downloads their
Kirby Super Star Ultra sprites into `art/monsters/` (local only). Every
creature is animated: waddling, hopping, flapping, spinning or swaying, and
turning to face the way it walks.

## Adding a monster

New creatures are real SLASH'EM monsters. Each one copies every stat, attack
and behaviour of an existing monster, and gets its own name, game tile and 3D
sprite.

1. Pick the SLASH'EM monster it should play like. All 638 are listed in
   `art/monsters/MONSTERS.txt`.
2. Get a sprite PNG with a transparent background.
3. Run:
   ```bash
   npm run monster -- "Waddle Dee" monkey ~/Downloads/waddle-dee.png
   ```
   This writes two things:
   - `mods/monsters/waddle-dee.json`: the definition, plus a 16x16 game tile
     made from the sprite. The tile is committed, and you can hand-edit it.
   - `art/monsters/waddle dee.png`: the full-size sprite shown in 3D. It
     stays local and isn't committed.
4. Rebuild with `npm run build` and restart the server. The new monster now
   appears in the dungeon on its own, wherever its base monster would.
   Add `"nogen": true` to its JSON to keep it out of random generation, so it
   only appears where a special level places it.

## Dev commands

Press **T** (or Enter, or /) in a game to open the command typer, then:

- `give <item>`: puts the item in your inventory. Name it the way you'd wish
  for it (`give blessed +3 silver dragon scale mail`, `give 20 melons`).
- `dev cheese`: a blessed +7 Grayswandir and "Blazing Cheese", a blessed +3
  red dragon scale mail. Wear it and every monster that hits you in melee is
  set on fire (3d6, unless it resists fire).
- `tp <level>`: straight to that level of the dungeon you're in (`tp 6` in
  Ascend: the Fountain of Dreams).

**Reset Game...** on the title screen deletes every saved character, their
block worlds and any bones (dead characters' levels that turn up in later
games), after asking; the high scores are kept. Not while a game is running.

**Every build wipes all saved games** (and their block worlds), so a save
never mixes with changed levels. Scores (`record`, `logfile`) are kept.

**Warning: adding or removing a monster changes the save format.** The build
bumps SLASH'EM's EDITLEVEL, so characters saved before the change can't be
restored.

## Chess

The third mode on the title screen: ordinary chess, played with NetHack's
monsters, in 3D, in a dungeon room with a brazier burning in each corner.
The Light (white: King Arthur, the Archon, stone golems, aligned priests,
warhorses, soldiers) against Gehennom (black: the Wizard of Yendor, Medusa,
iron golems, liches, Nightmares, hill orcs). Click a piece, then a square;
drag to look round, scroll to zoom. Play the computer or a friend. Every
move is written in the chat in algebraic notation; taken pieces line up
beside the board. All the rules: castling, en passant, promotion (you
choose), check, checkmate, stalemate, the fifty-move rule, threefold
repetition, insufficient material (`web/js/chess.js`).

## Races

Besides SLASH'EM's own races, MineHack adds two, and lets dwarves and elves
be any role (of any alignment the role allows):

- **Quantum:** born of a quantum mechanic. You teleport at random, from the
  very start.
- **Angel:** you fly, and see invisible, from the start.

## Tilesets

Options > Tileset redraws the monsters, items and map features:

- **SLASH'EM**: the game's own 16px tiles
- **Dungeon Crawl**: RLTiles' 32px NetHack set, plus Dungeon Crawl Stone
  Soup's art for some of SLASH'EM's additions (both public domain / CC0)
- **Absurd**: only if you build it yourself from your own copy (it can't be
  shared)

Anything a tileset lacks keeps its SLASH'EM tile, and our own monsters (the
Kirby crew) always keep their own art. Building them is described in
[tools/tilesets/README.md](tools/tilesets/README.md).

## Music

Drop tracker modules (.xm .mod .s3m .it .mo3 ...) into `music/` (any
subfolders) and they shuffle-play in the background through libopenmpt
(`web/vendor/chiptune3`), starting on a random track every session and every
game you start.
N skips to the next track; volume is under Options.

## How it works

```
browser (WebGL2 + DOM HUD)  <-- SSE / POST -->  server/server.js  <-- pipes -->  nethack
                                                                   stdin: commands
                                                                   fd 3: JSON events
```

`port/winweb.c` is a window port compiled into SLASH'EM. `tools/patch_engine.py`
adds small hooks to the game core so placed blocks, climbing and fall damage
are real game rules. `tools/add_monsters.py` adds the custom monsters from
`mods/monsters/`. Instead of drawing a terminal it
streams map glyphs (with tile indices from NetHack's own `glyph2tile[]`),
visibility, status, inventory, menus and prompts as JSON lines, and reads
keys / clicks / menu picks from stdin. Closing the tab saves the game.

## Build & run

Needs gcc, make, python3, node (no npm packages).

```bash
npm run build   # clones + builds SLASH'EM into build/ and makes the tile atlas
npm start       # http://127.0.0.1:8080/
```

Rebuilding wipes saved games (and their block worlds) but keeps bones and
score files (the games' own `make install` would otherwise wipe the whole game
directory).

To let others on your network play, start the server listening on all
interfaces and give them your machine's address:

```bash
HOST=0.0.0.0 npm start   # then they open http://<your-ip>:8080/
```

Each browser tab is its own game. Saves go by character name, so everyone
needs a different one.

## Windows

`MineHack-windows.zip` (on the GitHub releases page) is the whole game for
Windows 10/11: unzip it anywhere and double-click `MineHack.exe`. It opens the
game in its own window (Edge app mode); closing the window saves and stops it.
Nothing to install: it carries its own Node.js and a Windows build of the
engine.

To make it (on Linux, with `mingw-w64` and `wine` installed):

```bash
npm run build                      # the Linux build first (patches the sources)
sh tools/build-windows.sh          # SLASH'EM for Windows -> build/win/game
sh tools/package-windows.sh        # -> build/win/MineHack-windows.zip
sh tools/package-windows.sh --private   # ...with your local art/ and music/ too
```

The engine is cross-compiled with MinGW; the data tools (makedefs, lev_comp,
dgn_comp, dlb) are built for Windows too and run under Wine, since the data
files' binary layout differs between Linux and Windows. The `--private` zip
holds third-party art and music: for family and friends, never for a public
release.

## Controls

| Key | Action |
| --- | --- |
| Mouse | look |
| WASD (+Shift) | move / rush, relative to the camera (8 directions) |
| Left click | attack toward the crosshair |
| Right click | use held item · open/close door · travel to the spot |
| Middle click | look at what's under the crosshair |
| 1-9 / wheel | hotbar |
| E | inventory |
| Q / Shift+Q | drop one / drop stack |
| Space | stairs if standing on them, else search |
| G R F Z X K O L C P | pick up, search, fire, cast, swap, kick, open, look, attributes, pray |
| T, Enter, / | command bar (extended commands like `loot`, `chat`, `keys <raw keys>`) |
| Tab | message history |
| F5 / M / F1 / F3 | camera / overhead map / hide HUD / debug info |
| \` | raw NetHack keys on/off (classic controls) |
| Esc | cancel prompt / game menu |

## License

The original code in this repository (the web client, server and tools) is
licensed under the GNU General Public License v3.0 (see `LICENSE`).

NetHack and SLASH'EM are distributed under the NetHack General Public License
(see `LICENSE.NetHack`). The window port in `port/` is compiled into those
games and the tile atlases in `web/assets/` are generated from their tile
sets, so those parts are covered by the NetHack General Public License.

// The Actions tab: every game command as a button, grouped like a game menu.
// Commands that need more input reuse the normal prompts (the inventory
// opens as a picker for "which item?", click-to-aim for directions).

const C = (k) => String.fromCharCode(k.charCodeAt(0) & 31); // Ctrl+key

// keys: raw keys to send; ext: extended command name; fn: client-side action;
// faith: for a follower of Jesus only
export const ACTION_GROUPS = [
  { title: 'Move & fight', items: [
    { label: 'Search', keys: 's', tip: 'Look for hidden doors and traps (s)' },
    { label: 'Rest', keys: '.', tip: 'Wait one turn (.)' },
    { label: 'Rest 20 turns', keys: '20s', tip: 'Search/rest for 20 turns' },
    { label: 'Kick', keys: C('d'), tip: 'Kick in a direction (Ctrl+D)' },
    { label: 'Fire', keys: 'f', tip: 'Fire your quivered ammo (f)' },
    { label: 'Throw', keys: 't', tip: 'Throw an item (t)' },
    { label: 'Open door', keys: 'o', tip: 'Open a door (o)' },
    { label: 'Close door', keys: 'c', tip: 'Close a door (c)' },
    { label: 'Game jump', ext: 'jump', tip: 'NetHack #jump (needs boots or knight)' },
    { label: 'Travel', keys: '_', tip: 'Travel to a spot you click (_)' },
    { label: 'Go up', keys: '<', tip: 'Climb stairs or a ladder (<)' },
    { label: 'Go down', keys: '>', tip: 'Go down stairs or a ladder (>)' },
  ] },
  { title: 'Items', items: [
    { label: 'Pick up', keys: ',', tip: 'Pick up items here (,)' },
    { label: 'Drop', keys: 'd', tip: 'Drop an item (d)' },
    { label: 'Drop many', keys: 'D', tip: 'Drop several items (D)' },
    { label: 'Eat', keys: 'e', tip: 'Eat something (e)' },
    { label: 'Drink', keys: 'q', tip: 'Quaff a potion (q)' },
    { label: 'Read', keys: 'r', tip: 'Read a scroll or book (r)' },
    { label: 'Zap wand', keys: 'z', tip: 'Zap a wand (z)' },
    { label: 'Apply', keys: 'a', tip: 'Use a tool (a)' },
    { label: 'Wield', keys: 'w', tip: 'Wield a weapon (w)' },
    { label: 'Swap weapons', keys: 'x', tip: 'Swap primary and alternate weapon (x)' },
    { label: 'Quiver', keys: 'Q', tip: 'Ready ammo (Q)' },
    { label: 'Wear', keys: 'W', tip: 'Wear armor (W)' },
    { label: 'Take off', keys: 'T', tip: 'Take off armor (T)' },
    { label: 'Put on', keys: 'P', tip: 'Put on a ring/amulet (P)' },
    { label: 'Remove', keys: 'R', tip: 'Remove a ring/amulet (R)' },
    { label: 'Dip', ext: 'dip', tip: 'Dip an item into something (#dip)' },
    { label: 'Engrave', keys: 'E', tip: 'Write in the dust, e.g. Elbereth (E)' },
    { label: 'Name item', ext: 'name', tip: 'Name or call an item (#name)' },
    { label: 'Adjust letters', ext: 'adjust', tip: 'Change inventory letters (#adjust)' },
  ] },
  { title: 'Magic & gods', items: [
    { label: 'Cast spell', keys: 'Z', tip: 'Cast a spell (Z)' },
    { label: 'Pray', ext: 'pray', tip: 'Pray to your god (#pray)' },
    { label: 'Offer', ext: 'offer', tip: 'Sacrifice at an altar (#offer)' },
    { label: 'Invoke', keys: '\xe9', tip: 'Call on an artifact\'s power (Alt+I, or #invoke)' },
    // the rites of a follower of Jesus (a Catholic figure: engine winweb.c), at his altar;
    // faith: shown only to his followers (no one else knows them: the engine refuses them too)
    { label: 'Celebrate Mass', ext: 'mass', faith: true, tip: 'A priest offers the Mass: a holy wafer and holy wine (#mass)' },
    { label: 'Receive Communion', ext: 'communion', faith: true, tip: 'Receive a holy wafer at the altar (#communion)' },
    { label: 'Give alms', ext: 'alms', faith: true, tip: 'Give gold to the poor at the altar (#alms)' },
    { label: 'Confess', ext: 'confess', faith: true, tip: 'Confess your sins at the altar; penance follows (#confess)' },
    { label: 'Turn undead', ext: 'turn', tip: 'Turn undead (#turn)' },
    { label: 'Enhance skills', ext: 'enhance', tip: 'Advance weapon/spell skills (#enhance)' },
    { label: 'Monster power', ext: 'monster', tip: 'Use a polymorphed form\'s power (#monster)' },
  ] },
  { title: 'Interact', items: [
    { label: 'Open chest', fn: 'loot', tip: 'Open a chest or box here' },
    { label: 'Force lock', ext: 'force', tip: 'Force open a locked box (#force)' },
    { label: 'Untrap', ext: 'untrap', tip: 'Disarm a trap (#untrap)' },
    { label: 'Chat', ext: 'chat', tip: 'Talk to someone (#chat)' },
    { label: 'Pay', keys: 'p', tip: 'Pay a shopkeeper (p)' },
    { label: 'Sit', ext: 'sit', tip: 'Sit down (#sit)' },
    { label: 'Ride', ext: 'ride', tip: 'Ride or dismount (#ride)' },
    { label: 'Wipe face', ext: 'wipe', tip: 'Wipe your face (#wipe)' },
    { label: 'Look here', keys: ':', tip: 'What is here? (:)' },
    { label: 'Look at...', keys: ';', tip: 'Look at something you click (;)' },
  ] },
  { title: 'Info', items: [
    { label: 'Character', keys: C('x'), tip: 'Attributes and status (Ctrl+X)' },
    { label: 'Spells', keys: '+', tip: 'Known spells (+)' },
    { label: 'Discoveries', keys: '\\', tip: 'Identified item types (\\)' },
    { label: 'Messages', fn: 'history', tip: 'Message history (Tab)' },
    { label: 'Conduct', ext: 'conduct', tip: 'Voluntary challenges (#conduct)' },
    { label: 'Dungeon overview', ext: 'overview', tip: 'Levels you have seen (#overview)' },
    { label: 'All commands...', fn: 'allcmds', tip: 'Every extended command' },
    { label: 'Help', keys: '?', tip: 'The game\'s help (?)' },
  ] },
];

// ---- Recommended: smart suggestions for right now --------------------------
// ctx: { hero:{x,y}, cell(x,y), classAt(x,y), stat, CM, dirKey([dx,dy]) }
// Each suggestion is an action (keys/ext/fn) plus "answers" for the prompts it
// will raise (e.g. the direction), so one click does the whole thing.
const DIR_NAMES = { y: 'NW', k: 'N', u: 'NE', h: 'W', l: 'E', b: 'SW', j: 'S', n: 'SE' };

export function recommend(ctx) {
  const { hero, CM, stat } = ctx;
  const out = [];
  const add = (a) => { if (!out.some((o) => o.label === a.label)) out.push(a); };
  const dirAns = (key) => [{ key, re: /direction|where/i }];

  // how you're doing (most urgent, so it comes first)
  if (stat) {
    if (stat.hp > 0 && stat.hp <= Math.max(5, stat.hpmax / 7)) add({ label: 'Pray', ext: 'pray', why: 'HP is very low!' });
    if (stat.uhs >= 3) { add({ label: 'Eat', keys: 'e', why: 'you are weak with hunger' }); add({ label: 'Pray', ext: 'pray', why: 'weak from hunger' }); }
    else if (stat.uhs === 2) add({ label: 'Eat', keys: 'e', why: 'you are hungry' });
  }

  // next to you
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = hero.x + dx, y = hero.y + dy;
      const c = ctx.cell(x, y), cl = ctx.classAt(x, y);
      if (!c) continue;
      const d = ctx.dirKey([dx, dy]), dn = DIR_NAMES[d];
      if (c.k === 'C') {
        add({ label: 'Open chest', fn: 'chestAt', target: { x, y }, why: `chest ${dn}` });
        add({ label: 'Kick chest', keys: '\x04', answers: dirAns(d), why: 'may pop the lock' });
      }
      if (c.k === 't' && c.c !== CM.web) add({ label: `Untrap ${dn}`, ext: 'untrap', answers: dirAns(d), why: 'trap next to you' });
      if (c.k === 't' && c.c === CM.web) add({ label: `Untrap web ${dn}`, ext: 'untrap', answers: dirAns(d), why: 'web' });
      if (cl && cl.type === 'door') {
        add({ label: `Open door ${dn}`, keys: 'o', answers: dirAns(d), why: 'closed door' });
        add({ label: `Kick door ${dn}`, keys: '\x04', answers: dirAns(d), why: 'if it is locked' });
      }
      if (cl && cl.type === 'odoor' && c.k === 'c') add({ label: `Close door ${dn}`, keys: 'c', answers: dirAns(d), why: 'open door' });
    }

  // what's right here
  const here = ctx.cell(hero.x, hero.y);
  const cm = here ? (here.bc >= 0 ? here.bc : here.c) : -1;
  const objs = stat && stat.here;
  if (objs && objs[1] > 0) {
    add({ label: 'Open chest', fn: 'loot', why: 'chest here' });
    add({ label: 'Force lock', ext: 'force', why: 'if it is locked' });
  }
  if (objs && objs[0] > objs[1]) add({ label: 'Pick up', keys: ',', why: 'items here' });
  if (cm === CM.upstair || cm === CM.upladder) add({ label: 'Go up', keys: '<', why: 'stairs here' });
  if (cm === CM.dnstair || cm === CM.dnladder) add({ label: 'Go down', keys: '>', why: 'stairs here' });
  if (cm === CM.altar) {
    if (stat && stat.faith) { // a follower of Jesus: his rites, not burnt offerings (Offer is still in Actions: he refuses it)
      if (stat.angry) add({ label: 'Confess', ext: 'confess', why: `${stat.faith} is angry` });
      if (stat.mass) add({ label: 'Celebrate Mass', ext: 'mass', why: 'altar here' });
      add({ label: 'Receive Communion', ext: 'communion', why: 'altar here' });
      add({ label: 'Give alms', ext: 'alms', why: 'altar here' });
    } else add({ label: 'Offer', ext: 'offer', why: 'altar here' });
    add({ label: 'Pray', ext: 'pray', why: 'altar here' });
  }
  if (cm === CM.grave) add({ label: 'Read the headstone', keys: 'r.', why: 'grave here' }); // (r, then "." for what's written here)
  if (cm === CM.fountain) { add({ label: 'Drink from fountain', keys: 'q', answers: [{ key: 'y', re: /fountain/i }], why: 'fountain' }); add({ label: 'Dip in fountain', ext: 'dip', why: 'fountain' }); }
  if (cm === CM.sink) add({ label: 'Drink from sink', keys: 'q', answers: [{ key: 'y', re: /sink/i }], why: 'sink' });
  if (cm === CM.throne || cm === CM.toilet) add({ label: 'Sit', ext: 'sit', why: cm === CM.throne ? 'throne' : 'toilet' });

  return out;
}

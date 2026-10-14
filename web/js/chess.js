// Chess mode: ordinary chess, played with NetHack's monsters.  The Light
// (white: King Arthur, the Archon, stone golems, aligned priests, warhorses,
// soldiers) against Gehennom (black: the Wizard of Yendor, Medusa, iron
// golems, liches, Nightmares, hill orcs).  Full rules: castling, en passant,
// promotion, check, checkmate, stalemate, the fifty-move rule, threefold
// repetition, insufficient material.  Play the computer (you're white) or a
// friend on the same screen.

const PIECES = {
  w: { k: 'King Arthur', q: 'Archon', r: 'stone golem', b: 'aligned priest', n: 'warhorse', p: 'soldier' },
  b: { k: 'Wizard of Yendor', q: 'Medusa', r: 'iron golem', b: 'lich', n: 'Nightmare', p: 'hill orc' },
};
const NAMES = { k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn' };
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// ---- the rules -----------------------------------------------------------------
// squares 0..63: 0 is a8 (top left, black's side), 63 is h1
const file = (s) => s & 7, rank = (s) => s >> 3;
const sqName = (s) => 'abcdefgh'[file(s)] + (8 - rank(s));
const other = (c) => (c === 'w' ? 'b' : 'w');
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1);

function startPosition() {
  const board = Array(64).fill(null);
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let f = 0; f < 8; f++) {
    board[f] = { t: back[f], c: 'b' };
    board[8 + f] = { t: 'p', c: 'b' };
    board[48 + f] = { t: 'p', c: 'w' };
    board[56 + f] = { t: back[f], c: 'w' };
  }
  return { board, turn: 'w', castle: { wk: true, wq: true, bk: true, bq: true }, ep: -1, half: 0, seen: {} };
}

// is square s attacked by colour `by`?
function attacked(board, s, by) {
  const f = file(s), r = rank(s);
  const pr = by === 'w' ? r + 1 : r - 1; // a pawn attacks from one rank behind (from its point of view)
  for (const df of [-1, 1]) {
    const q = at(f + df, pr);
    if (q >= 0 && board[q] && board[q].c === by && board[q].t === 'p') return true;
  }
  for (const [df, dr] of KNIGHT) {
    const q = at(f + df, r + dr);
    if (q >= 0 && board[q] && board[q].c === by && board[q].t === 'n') return true;
  }
  for (const [df, dr] of KING) {
    const q = at(f + df, r + dr);
    if (q >= 0 && board[q] && board[q].c === by && board[q].t === 'k') return true;
  }
  for (const [dirs, kinds] of [[ROOK, 'rq'], [BISHOP, 'bq']])
    for (const [df, dr] of dirs)
      for (let i = 1; ; i++) {
        const q = at(f + df * i, r + dr * i);
        if (q < 0) break;
        const p = board[q];
        if (p) { if (p.c === by && kinds.includes(p.t)) return true; break; }
      }
  return false;
}

const kingSquare = (board, c) => board.findIndex((p) => p && p.t === 'k' && p.c === c);
const inCheck = (st, c = st.turn) => attacked(st.board, kingSquare(st.board, c), other(c));

// moves: {from, to, promo?, castle?, ep?}
function pseudoMoves(st) {
  const { board, turn: c } = st, out = [];
  const add = (from, to, extra) => out.push({ from, to, ...extra });
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!p || p.c !== c) continue;
    const f = file(s), r = rank(s);
    if (p.t === 'p') {
      const dir = c === 'w' ? -1 : 1, startRank = c === 'w' ? 6 : 1, lastRank = c === 'w' ? 0 : 7;
      const pawnTo = (to, extra) => {
        if (rank(to) === lastRank) for (const promo of 'qrbn') add(s, to, { ...extra, promo });
        else add(s, to, extra);
      };
      const one = at(f, r + dir);
      if (one >= 0 && !board[one]) {
        pawnTo(one);
        const two = at(f, r + 2 * dir);
        if (r === startRank && !board[two]) add(s, two, { double: true });
      }
      for (const df of [-1, 1]) {
        const q = at(f + df, r + dir);
        if (q < 0) continue;
        if (board[q] && board[q].c !== c) pawnTo(q);
        else if (q === st.ep) add(s, q, { ep: true });
      }
    } else if (p.t === 'n' || p.t === 'k') {
      for (const [df, dr] of p.t === 'n' ? KNIGHT : KING) {
        const q = at(f + df, r + dr);
        if (q >= 0 && (!board[q] || board[q].c !== c)) add(s, q);
      }
      if (p.t === 'k') {
        const home = c === 'w' ? 60 : 4, them = other(c);
        if (s === home && !attacked(board, s, them)) {
          if (st.castle[c + 'k'] && !board[s + 1] && !board[s + 2] && board[s + 3] && board[s + 3].t === 'r'
              && !attacked(board, s + 1, them) && !attacked(board, s + 2, them)) add(s, s + 2, { castle: 'k' });
          if (st.castle[c + 'q'] && !board[s - 1] && !board[s - 2] && !board[s - 3] && board[s - 4] && board[s - 4].t === 'r'
              && !attacked(board, s - 1, them) && !attacked(board, s - 2, them)) add(s, s - 2, { castle: 'q' });
        }
      }
    } else {
      const dirs = p.t === 'r' ? ROOK : p.t === 'b' ? BISHOP : [...ROOK, ...BISHOP];
      for (const [df, dr] of dirs)
        for (let i = 1; ; i++) {
          const q = at(f + df * i, r + dr * i);
          if (q < 0) break;
          if (board[q]) { if (board[q].c !== c) add(s, q); break; }
          add(s, q);
        }
    }
  }
  return out;
}

function makeMove(st, m) {
  const board = st.board.slice(), p = board[m.from], c = st.turn;
  const captured = m.ep ? board[m.to + (c === 'w' ? 8 : -8)] : board[m.to];
  board[m.to] = m.promo ? { t: m.promo, c } : p;
  board[m.from] = null;
  if (m.ep) board[m.to + (c === 'w' ? 8 : -8)] = null;
  if (m.castle === 'k') { board[m.from + 1] = board[m.from + 3]; board[m.from + 3] = null; }
  if (m.castle === 'q') { board[m.from - 1] = board[m.from - 4]; board[m.from - 4] = null; }
  const castle = { ...st.castle };
  if (p.t === 'k') castle[c + 'k'] = castle[c + 'q'] = false;
  for (const [sq, right] of [[63, 'wk'], [56, 'wq'], [7, 'bk'], [0, 'bq']])
    if (m.from === sq || m.to === sq) castle[right] = false;
  const next = { board, turn: other(c), castle, ep: m.double ? (m.from + m.to) / 2 : -1,
    half: p.t === 'p' || captured ? 0 : st.half + 1, seen: st.seen, captured };
  return next;
}

function legalMoves(st) {
  return pseudoMoves(st).filter((m) => {
    const n = makeMove(st, m);
    return !attacked(n.board, kingSquare(n.board, st.turn), n.turn);
  });
}

const posKey = (st) => st.board.map((p) => (p ? (p.c === 'w' ? p.t.toUpperCase() : p.t) : '.')).join('')
  + st.turn + Object.entries(st.castle).filter(([, v]) => v).map(([k]) => k).join('') + st.ep;

function insufficient(board) {
  const rest = board.filter((p) => p && p.t !== 'k');
  if (rest.length === 0) return true;
  return rest.length === 1 && (rest[0].t === 'n' || rest[0].t === 'b');
}

// -> null (play on), or {over: true, text}
function outcome(st, moves = legalMoves(st)) {
  if (!moves.length) {
    if (inCheck(st)) return { over: true, winner: other(st.turn), text: `Checkmate! ${st.turn === 'w' ? 'Gehennom' : 'The Light'} wins.` };
    return { over: true, text: 'Stalemate: a draw.' };
  }
  if (st.half >= 100) return { over: true, text: 'Fifty moves without a capture or a pawn move: a draw.' };
  if ((st.seen[posKey(st)] || 0) >= 3) return { over: true, text: 'The same position three times: a draw.' };
  if (insufficient(st.board)) return { over: true, text: 'Neither side can checkmate: a draw.' };
  return null;
}

// ---- the computer: alpha-beta search over material and piece placement --------
// piece-square bonuses (from white's side, square 0 = a8)
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
function evaluate(st) { // from the side to move's point of view
  let score = 0;
  for (let s = 0; s < 64; s++) {
    const p = st.board[s];
    if (!p) continue;
    const v = VALUE[p.t] + PST[p.t][p.c === 'w' ? s : (7 - rank(s)) * 8 + file(s)];
    score += p.c === 'w' ? v : -v;
  }
  return st.turn === 'w' ? score : -score;
}
const ordered = (st, moves) => moves.map((m) => {
  const victim = m.ep ? 'p' : st.board[m.to] && st.board[m.to].t;
  return { m, k: (victim ? 10 * VALUE[victim] - VALUE[st.board[m.from].t] : 0) + (m.promo ? VALUE[m.promo] : 0) };
}).sort((a, b) => b.k - a.k).map((x) => x.m);

function quiesce(st, alpha, beta, depth) {
  const stand = evaluate(st);
  if (stand >= beta || depth <= 0) return stand;
  if (stand > alpha) alpha = stand;
  for (const m of ordered(st, legalMoves(st).filter((m) => m.ep || st.board[m.to] || m.promo))) {
    const v = -quiesce(makeMove(st, m), -beta, -alpha, depth - 1);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}
function search(st, depth, alpha, beta, ply) {
  const moves = legalMoves(st);
  if (!moves.length) return inCheck(st) ? -100000 + ply : 0;
  if (st.half >= 100) return 0;
  if (depth <= 0) return quiesce(st, alpha, beta, 4);
  for (const m of ordered(st, moves)) {
    const v = -search(makeMove(st, m), depth - 1, -beta, -alpha, ply + 1);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}
function bestMove(st, depth = 3) {
  let best = null, bestV = -Infinity;
  for (const m of ordered(st, legalMoves(st))) {
    const n = makeMove(st, m);
    // (steer away from repeating into a draw when ahead)
    const v = -search(n, depth - 1, -Infinity, -bestV, 1) + Math.random() * 6;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

// a move in standard algebraic notation: Nf3, exd5, O-O, e8=Q+, Qxf7#...
// (st: the position before it)
export function san(st, m) {
  const p = st.board[m.from], legal = legalMoves(st);
  let text;
  if (m.castle) text = m.castle === 'k' ? 'O-O' : 'O-O-O';
  else {
    const capture = !!st.board[m.to] || m.ep;
    if (p.t === 'p') text = (capture ? 'abcdefgh'[file(m.from)] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      // another piece of the same kind could go there too: say which one moved
      const rivals = legal.filter((o) => o.to === m.to && o.from !== m.from && st.board[o.from].t === p.t);
      let which = '';
      if (rivals.length) {
        if (!rivals.some((o) => file(o.from) === file(m.from))) which = 'abcdefgh'[file(m.from)];
        else if (!rivals.some((o) => rank(o.from) === rank(m.from))) which = String(8 - rank(m.from));
        else which = sqName(m.from);
      }
      text = p.t.toUpperCase() + which + (capture ? 'x' : '') + sqName(m.to);
    }
  }
  const after = makeMove(st, m);
  if (inCheck(after)) text += legalMoves(after).length ? '+' : '#';
  return text;
}

// ---- the game: its panel (status, promotion, buttons); the board itself is
// drawn in 3D by main.js from view(), and clicks come back through click()
// api: { tileIcon(tile, size), tileOf(name), onBack(), log(text): the moves,
// in algebraic notation, go to the chat }
export const pieceName = (p) => PIECES[p.c][p.t];
export function createChess(root, api) {
  const $ = (q) => root.querySelector(q);
  const statusEl = $('.chess-status'), takenEl = $('.chess-taken'), promoEl = $('.chess-promo');
  let st, sel = -1, targets = [], last = null, over = null, vsComputer = true, thinking = false, taken = [], note = '', moveNo = 1;
  const log = (text) => api.log && api.log(text);

  function newGame() {
    st = startPosition();
    st.seen = { [posKey(st)]: 1 };
    sel = -1; targets = []; last = null; over = null; thinking = false; taken = []; note = ''; moveNo = 1;
    promoEl.innerHTML = '';
    log(`A new game of chess: the Light (white) against Gehennom (black)${vsComputer ? ', the computer playing Gehennom' : ''}.`);
    panel();
  }

  function play(m) {
    const p = st.board[m.from];
    const written = san(st, m);
    note = `${st.turn === 'w' ? moveNo + '.' : moveNo + '...'} ${written}`;
    log(`${note}  (${pieceName(p)})`);
    if (st.turn === 'b') moveNo++;
    st = makeMove(st, m);
    st.seen = { ...st.seen };
    const key = posKey(st);
    st.seen[key] = (st.seen[key] || 0) + 1;
    if (st.captured) taken.push(st.captured);
    last = m; sel = -1; targets = [];
    over = outcome(st);
    if (over) log(over.text + (over.winner ? (over.winner === 'w' ? '  1-0' : '  0-1') : '  ½-½'));
    panel();
    if (!over && vsComputer && st.turn === 'b') computerMove();
  }

  function computerMove() {
    thinking = true;
    panel();
    setTimeout(() => { // (let the board show the player's move first)
      const m = bestMove(st, 3);
      thinking = false;
      if (m) play(m);
    }, 250);
  }

  // a square was clicked (0..63), or -1 for off the board
  function click(s) {
    if (over || thinking || promoEl.childElementCount) return;
    if (vsComputer && st.turn !== 'w') return;
    const moves = s < 0 ? [] : targets.filter((m) => m.to === s);
    if (moves.length) {
      if (moves[0].promo) choosePromotion(moves);
      else play(moves[0]);
      return;
    }
    const p = s < 0 ? null : st.board[s];
    if (p && p.c === st.turn) {
      sel = s;
      targets = legalMoves(st).filter((m) => m.from === s);
    } else { sel = -1; targets = []; }
  }

  function choosePromotion(moves) {
    promoEl.innerHTML = '<div>Promote to:</div>';
    for (const t of 'qrbn') {
      const b = document.createElement('button');
      b.className = 'chess-promo-btn';
      b.title = `${NAMES[t]}: ${PIECES[st.turn][t]}`;
      b.appendChild(api.tileIcon(api.tileOf(PIECES[st.turn][t]), 40));
      b.onclick = () => { promoEl.innerHTML = ''; play(moves.find((m) => m.promo === t)); };
      promoEl.appendChild(b);
    }
  }

  function panel() {
    const who = st.turn === 'w' ? 'White (the Light)' : 'Black (Gehennom)';
    const now = over ? over.text : thinking ? 'Gehennom is thinking...' : `${who} to move${inCheck(st) ? ': check!' : '.'}`;
    statusEl.textContent = (note ? note + '. ' : '') + now;
    takenEl.innerHTML = '';
    for (const c of ['w', 'b']) {
      const row = document.createElement('div');
      row.className = 'chess-taken-row';
      for (const p of taken.filter((x) => x.c === c)) row.appendChild(api.tileIcon(api.tileOf(pieceName(p)), 22));
      takenEl.appendChild(row);
    }
  }

  // what the 3D board shows
  function view() {
    return { board: st.board, sel, targets: targets.map((m) => m.to), last,
      check: inCheck(st) ? kingSquare(st.board, st.turn) : -1, taken };
  }

  $('[data-act=chess-new]').onclick = newGame;
  const modeBtn = $('[data-act=chess-mode]');
  const showMode = () => (modeBtn.textContent = `Opponent: ${vsComputer ? 'Computer' : 'Two players'}`);
  modeBtn.onclick = () => { vsComputer = !vsComputer; showMode(); newGame(); };
  $('[data-act=chess-back]').onclick = () => api.onBack();
  showMode();
  newGame();
  return { click, view, redraw: panel };
}

// CONVERGENCE — a turn-based 2-4 player strategy game for humans and agents.
// Pure engine: no I/O. Deterministic given a seed and the move list.
//
// RULES (one paragraph):
// Eight districts sit on the board, each needing THRESHOLD influence tokens before
// it can be won. On your turn you take exactly one action: PLACE (spend 1 influence
// to put one token on a district), DRAW (take a card and gain 1 influence), or PLAY
// a card. A district is won the instant one player alone has placed THRESHOLD tokens
// on it; tokens placed there by rivals are lost. So districts are contests, not
// purchases, and committing early invites a race you may not win. Every third round
// the district with the fewest tokens is demolished. The match ends when all eight
// districts are resolved or round 14 ends. Score = district thresholds you won,
// + 2 per card left in hand, + your remaining influence. Highest score wins.

export const CARDS = ['SURGE', 'TAX', 'SHIELD', 'SWAP'];
export const MAX_ROUNDS = 14;
export const START_INFLUENCE = 14;
export const START_HAND = 3;
export const DEMOLISH_EVERY = 4;

export const DISTRICTS = [
  { id: 'd1', name: 'Foundry', threshold: 2 },
  { id: 'd2', name: 'Relay', threshold: 2 },
  { id: 'd3', name: 'Archive', threshold: 3 },
  { id: 'd4', name: 'Kiln', threshold: 3 },
  { id: 'd5', name: 'Spire', threshold: 3 },
  { id: 'd6', name: 'Lattice', threshold: 4 },
  { id: 'd7', name: 'Nexus', threshold: 4 },
  { id: 'd8', name: 'Meridian', threshold: 5 },
];

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deck(seed) {
  const rng = mulberry32(seed);
  return () => CARDS[Math.floor(rng() * CARDS.length)];
}

export function createGame({ id, players, seed = 1, botFill = true }) {
  if (players.length < 2 || players.length > 4) throw new Error('need 2-4 players');
  const drawCard = deck(seed);
  const state = {
    id,
    seed,
    round: 1,
    turn: 0,
    order: [],
    districts: DISTRICTS.map((d) => ({ ...d, owner: null, tokens: {} })),
    log: [],
    over: false,
    winner: null,
    createdAt: Date.now(),
    botFill,
    _drawCard: drawCard,
  };
  for (const p of players) {
    state.order.push({
      id: p.id,
      name: p.name,
      kind: p.kind,
      influence: START_INFLUENCE,
      hand: Array.from({ length: START_HAND }, () => drawCard()),
      shield: false,
    });
  }
  push(state, `match started with ${state.order.map((p) => p.name).join(', ')}`);
  return state;
}

function push(state, text) {
  state.log.push({ round: state.round, text, at: state.log.length });
}

export function playerById(state, id) {
  return state.order.find((p) => p.id === id);
}

export function currentPlayer(state) {
  return state.over ? null : state.order[state.turn];
}

export function tokensOn(state, d, playerId) {
  return d.tokens[playerId] || 0;
}

export function legalActions(state) {
  if (state.over) return [];
  const p = currentPlayer(state);
  const acts = [];
  for (const d of state.districts) {
    if (d.owner !== null) continue;
    const cost = 1;
    if (cost <= p.influence) acts.push({ type: 'PLACE', district: d.id, cost });
  }
  acts.push({ type: 'DRAW' });
  if (p.influence >= 1) for (const card of [...new Set(p.hand)]) acts.push({ type: 'PLAY', card });
  return acts;
}

export function applyAction(state, playerId, action) {
  if (state.over) throw new Error('match is over');
  const p = currentPlayer(state);
  if (!p || p.id !== playerId) throw new Error('not your turn');
  const legal = legalActions(state);
  const ok = legal.some((a) =>
    a.type === action.type &&
    (a.type !== 'PLACE' || a.district === action.district) &&
    (a.type !== 'PLAY' || a.card === action.card)
  );
  if (!ok) throw new Error(`illegal action: ${JSON.stringify(action)}`);

  if (action.type === 'PLACE') {
    const d = state.districts.find((x) => x.id === action.district);
    if (!d || d.owner !== null) throw new Error('district unavailable');
    // Flat cost. Dominance is removed by DRAW being the only influence source
    // and by cards costing 1 influence to play, so tempo is never free.
    const already = d.tokens[p.id] || 0;
    const cost = 1;
    if (p.influence < cost) throw new Error('not enough influence for that placement');
    p.influence -= cost;
    d.tokens[p.id] = already + 1;
    const n = d.tokens[p.id];
    push(state, `${p.name} places on ${d.name} (${n}/${d.threshold}, -${cost})`);
    if (n >= d.threshold) {
      d.owner = p.id;
      // rival tokens on a won district are lost with it
      for (const q of state.order) if (q.id !== p.id) delete d.tokens[q.id];
      d.tokens[p.id] = d.threshold;
      push(state, `${p.name} WINS ${d.name}`);
    }
  } else if (action.type === 'DRAW') {
    if (p.hand.length < 5) p.hand.push(state._drawCard());
    push(state, `${p.name} draws a card`);
  } else if (action.type === 'PLAY') {
    if (p.influence < 1) throw new Error('need 1 influence to play a card');
    p.influence -= 1;
    p.hand.splice(p.hand.indexOf(action.card), 1);
    if (action.card === 'SURGE') {
      p.influence += 2;
      push(state, `${p.name} plays SURGE (+2 influence)`);
    } else if (action.card === 'TAX') {
      const richest = [...state.order].filter((q) => q.id !== p.id)
        .sort((a, b) => b.influence - a.influence)[0];
      if (richest && !richest.shield) { richest.influence = Math.max(0, richest.influence - 3); push(state, `${p.name} plays TAX (${richest.name} loses 3)`); }
      else if (richest) { richest.shield = false; push(state, `${p.name} plays TAX (${richest.name} shielded)`); }
    } else if (action.card === 'SHIELD') {
      p.shield = true;
      push(state, `${p.name} plays SHIELD`);
    } else if (action.card === 'SWAP') {
      const leader = [...state.order].sort((a, b) => b.influence - a.influence)[0];
      if (leader && leader.id !== p.id) {
        const t = p.influence; p.influence = leader.influence; leader.influence = t;
        push(state, `${p.name} plays SWAP with ${leader.name}`);
      } else {
        push(state, `${p.name} plays SWAP (already leading)`);
      }
    }
  }

  advance(state);
  return state;
}

function advance(state) {
  state.turn += 1;
  if (state.turn >= state.order.length) {
    state.turn = 0;
    state.round += 1;
    if (state.round % DEMOLISH_EVERY === 0) {
      const open = state.districts.filter((d) => d.owner === null);
      if (open.length > 0) {
        const weakest = open
          .map((d) => ({ d, n: Object.values(d.tokens).reduce((a, b) => a + b, 0) }))
          .sort((a, b) => a.n - b.n || a.d.threshold - b.d.threshold)[0].d;
        weakest.owner = 'demolished';
        push(state, `${weakest.name} is demolished`);
      }
    }
  }
  const open = state.districts.filter((d) => d.owner === null).length;
  if (open === 0 || state.round > MAX_ROUNDS) {
    state.over = true;
    const scores = score(state);
    // Tiebreak, in order: score, districts won, influence held. Only a perfect
    // tie on all three is a draw.
    const best = [...scores].sort((a, b) =>
      b.score - a.score ||
      b.districtPoints - a.districtPoints ||
      b.influence - a.influence)[0];
    const tied = scores.filter((s) =>
      s.score === best.score &&
      s.districtPoints === best.districtPoints &&
      s.influence === best.influence);
    state.winner = tied.length === 1 ? best.id : null;
    push(state, `match over — ${scores.map((s) => `${s.name}:${s.score}`).join(', ')}` +
      (state.winner ? ` — ${best.name} wins` : ' — draw'));
  }
}

export function score(state) {
  return state.order
    .map((p) => {
      const won = state.districts.filter((d) => d.owner === p.id);
      const districtPoints = won.reduce((s, d) => s + d.threshold, 0);
      const cardBonus = p.hand.length * 2;
      return {
        id: p.id,
        name: p.name,
        owned: won.map((d) => d.id),
        districtPoints,
        cardBonus,
        influence: p.influence,
        score: districtPoints + cardBonus + p.influence,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// Documented sample bot. One meaningful rule: finish a district you have the most
// tokens on; otherwise draw for influence; spend cards only when taxed or leading.
export function sampleBotMove(state, playerId) {
  if (currentPlayer(state)?.id !== playerId) return null;
  const acts = legalActions(state);
  if (acts.length === 0) return null;
  const p = currentPlayer(state);

  const places = acts.filter((a) => a.type === 'PLACE');
  const scored = places.map((a) => {
    const d = state.districts.find((x) => x.id === a.district);
    const mine = tokensOn(state, d, p.id);
    const rivals = Object.entries(d.tokens)
      .filter(([k]) => k !== p.id)
      .reduce((s, [, v]) => s + v, 0);
    return { a, d, mine, rivals, need: d.threshold - mine, prize: d.threshold };
  });

  // 1. Complete a district: closest to threshold and uncontested enough to finish.
  const finishing = scored.filter((s) => s.need <= p.influence)
    .sort((x, y) => y.prize - x.prize || x.need - y.need)[0];
  if (finishing && finishing.need <= 1) return finishing.a;

  // 2. Contest a district we already lead.
  const leading = scored.filter((s) => s.mine > s.rivals && s.mine > 0 && s.need <= 1)
    .sort((x, y) => y.prize - x.prize)[0];
  if (leading && p.influence > 2) return leading.a;

  // 3. Play TAX when a rival is close to winning something.
  const tax = acts.find((a) => a.type === 'PLAY' && a.card === 'TAX');
  const rivalClose = state.districts.some((d) => d.owner === null &&
    Object.entries(d.tokens).some(([k, v]) => k !== p.id && v >= d.threshold - 1));
  if (tax && rivalClose) return tax;

  // 4. Otherwise build influence.
  const draw = acts.find((a) => a.type === 'DRAW');
  if (draw && p.influence < 4) return draw;

  // 5. Open a fresh district with the smallest remaining gap.
  const fresh = scored.sort((x, y) => x.need - y.need || y.prize - x.prize)[0];
  if (fresh && p.influence > 0) return fresh.a;
  return draw || acts[0];
}

export function publicView(state, viewerId = null) {
  return {
    id: state.id,
    round: state.round,
    maxRounds: MAX_ROUNDS,
    over: state.over,
    winner: state.winner,
    turn: state.over ? null : currentPlayer(state).id,
    you: viewerId,
    districts: state.districts.map((d) => ({
      id: d.id,
      name: d.name,
      threshold: d.threshold,
      owner: d.owner,
      tokens: d.tokens,
      leader: (() => {
        const e = Object.entries(d.tokens).sort((a, b) => b[1] - a[1])[0];
        return e ? { player: e[0], count: e[1] } : null;
      })(),
    })),
    players: state.order.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      influence: p.influence,
      handCount: p.hand.length,
      shield: p.shield,
      hand: p.id === viewerId ? p.hand : undefined,
    })),
    scores: score(state),
    log: state.log,
    legal: viewerId && !state.over && currentPlayer(state)?.id === viewerId
      ? legalActions(state)
      : [],
  };
}

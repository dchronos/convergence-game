#!/usr/bin/env node
// Reproduces the balance table in README.md. No dependencies.
// Usage: node verify-balance.mjs [gamesPerPairing]
import { createGame, legalActions, applyAction, currentPlayer, sampleBotMove } from './engine.mjs';

const N = Number(process.argv[2] || 100);

// Four fixed policies. Each is a pure function of (state, playerId).
const ARCHETYPES = {
  // Never contests: draws every turn.
  turtle: (s, p) => legalActions(s).find((a) => a.type === 'DRAW') || legalActions(s)[0],
  // Rushes the cheapest open district every turn, ignoring what it already holds.
  'always-place': (s, p) => {
    const l = legalActions(s);
    return l.find((a) => a.type === 'PLACE') || l.find((a) => a.type === 'DRAW') || l[0];
  },
  // Develops districts it already started, cheapest prize first on a tie.
  spread: (s, p) => {
    const l = legalActions(s);
    const places = l
      .filter((a) => a.type === 'PLACE')
      .map((a) => {
        const d = s.districts.find((x) => x.id === a.district);
        return { a, d, mine: (d.tokens || {})[p] || 0 };
      })
      .sort((x, y) => y.mine - x.mine || x.d.threshold - y.d.threshold);
    return places[0]?.a || l.find((a) => a.type === 'DRAW') || l[0];
  },
  // The engine's conditional bot.
  'reference bot': (s, p) => sampleBotMove(s, p),
};

function play(aName, bName, seed) {
  const s = createGame({
    id: 'verify',
    players: [
      { id: 'p1', name: aName, kind: 'agent' },
      { id: 'p2', name: bName, kind: 'agent' },
    ],
    seed,
  });
  let n = 0;
  while (!s.over && n < 2000) {
    const p = currentPlayer(s);
    const move = p.id === 'p1' ? ARCHETYPES[aName](s, p.id) : ARCHETYPES[bName](s, p.id);
    if (!move) break;
    applyAction(s, p.id, move);
    n++;
  }
  return s;
}

const names = Object.keys(ARCHETYPES);
const wins = Object.fromEntries(names.map((n) => [n, 0]));
let draws = 0;

for (const a of names) {
  for (const b of names) {
    if (a >= b) continue;
    let aw = 0;
    let bw = 0;
    let dr = 0;
    for (let seed = 1; seed <= N; seed++) {
      const s = play(a, b, seed);
      if (!s.winner) dr++;
      else if (s.winner === 'p1') aw++;
      else bw++;
    }
    wins[a] += aw;
    wins[b] += bw;
    draws += dr;
    console.log(`  ${a} vs ${b}`.padEnd(30), `${aw}-${bw}`.padEnd(10), dr ? `(${dr} draws)` : '');
  }
}

const pairings = (names.length * (names.length - 1)) / 2;
const total = N * pairings;
// Each pairing is N games; a player's wins accumulate across its 3 pairings.
console.log(`\n${total} games in ${pairings} pairings; wins per archetype:`, JSON.stringify(wins), 'draws', draws);

// Four-player shape: does a table of reference bots finish, and how full is the board?
let districts = 0;
let rounds = 0;
let fourDraws = 0;
const FOUR = 100;
for (let seed = 1; seed <= FOUR; seed++) {
  const s = createGame({
    id: 'shape',
    players: ['A', 'B', 'C', 'D'].map((name, i) => ({ id: `p${i + 1}`, name, kind: 'agent' })),
    seed,
  });
  let n = 0;
  while (!s.over && n < 2000) {
    const p = currentPlayer(s);
    const move = sampleBotMove(s, p.id);
    if (!move) break;
    applyAction(s, p.id, move);
    n++;
  }
  districts += s.districts.filter((d) => d.owner && d.owner.startsWith('p')).length;
  rounds += s.round;
  if (!s.winner) fourDraws++;
}
console.log(
  `4p shape (${FOUR} games): districts ${(districts / FOUR).toFixed(1)}/8, ` +
  `rounds ${(rounds / FOUR).toFixed(1)}, draws ${fourDraws}/${FOUR}`,
);

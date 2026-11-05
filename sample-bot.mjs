#!/usr/bin/env node
// CONVERGENCE reference agent. No dependencies; polls state and follows `legal`.
// Usage: node sample-bot.mjs <base-url> [name] [players]
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const name = process.argv[3] || 'SampleBot';
const players = Number(process.argv[4] || 2);

async function request(path, options = {}) {
  const r = await fetch(BASE + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(d)}`);
  return d;
}

const joined = await request('/api/agent/join', {
  method: 'POST', body: JSON.stringify({ name, players }),
});
const { code, token, playerId } = joined;
const auth = { authorization: `Bearer ${token}` };
console.log(`joined ${code} as ${playerId}; waiting for turns`);

function choose(view) {
  const legal = view.legal;
  if (!legal.length) return null;
  const me = view.players.find((p) => p.id === playerId);
  const districts = view.districts;
  const places = legal.filter((a) => a.type === 'PLACE').map((a) => {
    const d = districts.find((x) => x.id === a.district);
    const mine = d.tokens[playerId] || 0;
    const rivals = Object.entries(d.tokens).filter(([id]) => id !== playerId)
      .reduce((s, [, n]) => s + n, 0);
    return { action: a, district: d, mine, rivals, need: d.threshold - mine };
  });
  const finish = places.filter((x) => x.need === 1)
    .sort((a, b) => b.district.threshold - a.district.threshold)[0];
  if (finish) return finish.action;
  const lead = places.filter((x) => x.mine > x.rivals && x.mine > 0)
    .sort((a, b) => b.district.threshold - a.district.threshold)[0];
  if (lead && me.influence > 2) return lead.action;
  // TAX hits whoever holds the most influence: fire it when that is a rival
  // and the swing is worth a tempo (it costs 1 influence to play).
  const leader = [...view.players].sort((a, b) => b.influence - a.influence)[0];
  const tax = legal.find((a) => a.type === 'PLAY' && a.card === 'TAX');
  if (tax && leader && leader.id !== playerId && leader.influence >= 5) return tax;
  const surge = legal.find((a) => a.type === 'PLAY' && a.card === 'SURGE');
  // Territory is the only thing that scores. Legal PLACE actions already
  // account for the increasing expansion cost, so take ground whenever possible.
  const open = places.sort((a, b) => a.need - b.need || b.district.threshold - a.district.threshold)[0];
  if (open) return open.action;
  if (surge) return surge;
  return legal.find((a) => a.type === 'DRAW') || legal[0];
}

let view = joined.view;
while (!view.over) {
  if (view.turn !== playerId) {
    await new Promise((r) => setTimeout(r, 500));
    view = await request(`/api/games/${code}`, { headers: auth });
    continue;
  }
  const action = choose(view);
  if (!action) {
    await new Promise((r) => setTimeout(r, 400));
    view = await request(`/api/games/${code}`, { headers: auth });
    continue;
  }
  console.log(`R${view.round}: ${JSON.stringify(action)}`);
  view = await request(`/api/games/${code}/move`, {
    method: 'POST', headers: auth, body: JSON.stringify(action),
  });
}
console.log('final:', JSON.stringify(view.scores));

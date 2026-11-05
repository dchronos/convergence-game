// CONVERGENCE server — zero dependencies. Node >= 18.
// Serves the browser client and the agent HTTP/JSON API.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  createGame, applyAction, legalActions, publicView, score,
  currentPlayer, playerById, sampleBotMove, MAX_ROUNDS,
} from './engine.mjs';

const PORT = Number(process.env.PORT || 8787);
const PUBLIC = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
const games = new Map();      // code -> state
const seats = new Map();      // token -> { code, playerId }
const TURN_MS = 60_000;       // 60s turn clock, bots move instantly

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-length': Buffer.byteLength(s),
  });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => {
      if (!d) return resolve({});
      try { resolve(JSON.parse(d)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const token = () => crypto.randomBytes(16).toString('hex');

function authOf(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  const u = new URL(req.url, 'http://x');
  return u.searchParams.get('token') || null;
}

function seatFor(req, state) {
  const t = authOf(req);
  if (!t) return null;
  const s = seats.get(t);
  if (!s || s.code !== state.id) return null;
  return s.playerId;
}

function runBots(state) {
  // Bots act immediately, in turn, until a human or agent seat is up.
  let guard = 0;
  while (!state.over && guard++ < 200) {
    const p = currentPlayer(state);
    if (!p || p.kind !== 'bot') break;
    const mv = sampleBotMove(state, p.id);
    if (!mv) break;
    applyAction(state, p.id, mv);
  }
}

function expireStale(state) {
  // Turn clock: if the same seat has held the turn too long, auto-pass for them.
  if (state.over) return;
  const p = currentPlayer(state);
  if (!p || p.kind === 'bot') return;
  const now = Date.now();
  if (!state.turnStartedAt) { state.turnStartedAt = now; state.turnWho = p.id; return; }
  if (state.turnWho !== p.id) { state.turnStartedAt = now; state.turnWho = p.id; return; }
  if (now - state.turnStartedAt > TURN_MS) {
    const acts = legalActions(state);
    const mv = acts.find((a) => a.type === 'PASS') || acts.find((a) => a.type === 'DRAW') || acts[0];
    if (mv) applyAction(state, p.id, mv);
    state.turnStartedAt = Date.now();
    state.turnWho = currentPlayer(state)?.id || null;
    runBots(state);
  }
}

function tickAll() {
  for (const st of games.values()) { expireStale(st); runBots(st); }
}
setInterval(tickAll, 2000).unref?.();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (req.method === 'OPTIONS') return json(res, 204, {});

  // ---------- API ----------
  if (p === '/api/health') return json(res, 200, { ok: true, games: games.size });

  if (p === '/api/games' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const n = Math.min(4, Math.max(2, Number(body.players) || 2));
      const name = String(body.name || 'Human').slice(0, 32);
      const id = code();
      const players = [{ id: 'p1', name, kind: 'human' }];
      for (let i = 2; i <= n; i++) players.push({ id: `p${i}`, name: `Open seat ${i}`, kind: 'bot' });
      const state = createGame({ id, players, seed: crypto.randomInt(1e9), botFill: true });
      state.turnStartedAt = Date.now();
      state.turnWho = currentPlayer(state).id;
      games.set(id, state);
      const t = token();
      seats.set(t, { code: id, playerId: 'p1' });
      runBots(state);
      return json(res, 201, { code: id, token: t, playerId: 'p1', view: publicView(state, 'p1') });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  const mJoin = p.match(/^\/api\/games\/([A-Z0-9]+)\/join$/);
  if (mJoin && req.method === 'POST') {
    const st = games.get(mJoin[1]);
    if (!st) return json(res, 404, { error: 'no such game' });
    if (st.over) return json(res, 409, { error: 'game already over' });
    try {
      const body = await readBody(req);
      const seat = st.order.find((x) => x.kind === 'bot');
      if (!seat) return json(res, 409, { error: 'no open seat' });
      seat.kind = 'human';
      seat.name = String(body.name || 'Human').slice(0, 32);
      const t = token();
      seats.set(t, { code: st.id, playerId: seat.id });
      return json(res, 200, { code: st.id, token: t, playerId: seat.id, view: publicView(st, seat.id) });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // Agent join: registers an agent seat on a fresh game with 1 human + bots.
  if (p === '/api/agent/join' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const name = String(body.name || 'Agent').slice(0, 32);
      const n = Math.min(4, Math.max(2, Number(body.players) || 2));
      const id = code();
      const players = [{ id: 'a1', name, kind: 'agent' }];
      for (let i = 2; i <= n; i++) players.push({ id: `a${i}`, name: `Bot ${i - 1}`, kind: 'bot' });
      const state = createGame({ id, players, seed: crypto.randomInt(1e9), botFill: true });
      state.turnStartedAt = Date.now();
      state.turnWho = currentPlayer(state).id;
      games.set(id, state);
      const t = token();
      seats.set(t, { code: id, playerId: 'a1' });
      return json(res, 201, { code: id, token: t, playerId: 'a1', view: publicView(state, 'a1') });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  const mState = p.match(/^\/api\/games\/([A-Z0-9]+)$/);
  if (mState && req.method === 'GET') {
    const st = games.get(mState[1]);
    if (!st) return json(res, 404, { error: 'no such game' });
    return json(res, 200, publicView(st, seatFor(req, st)));
  }

  const mMove = p.match(/^\/api\/games\/([A-Z0-9]+)\/move$/);
  if (mMove && req.method === 'POST') {
    const st = games.get(mMove[1]);
    if (!st) return json(res, 404, { error: 'no such game' });
    const who = seatFor(req, st);
    if (!who) return json(res, 401, { error: 'missing or wrong token' });
    try {
      const mv = await readBody(req);
      applyAction(st, who, mv);
      st.turnStartedAt = Date.now();
      st.turnWho = currentPlayer(st)?.id || null;
      runBots(st);
      return json(res, 200, publicView(st, who));
    } catch (e) { return json(res, 400, { error: e.message, legal: legalActions(st) }); }
  }

  const mLog = p.match(/^\/api\/games\/([A-Z0-9]+)\/log$/);
  if (mLog && req.method === 'GET') {
    const st = games.get(mLog[1]);
    if (!st) return json(res, 404, { error: 'no such game' });
    return json(res, 200, { code: st.id, log: st.log, scores: score(st), over: st.over });
  }

  // ---------- static ----------
  if (p === '/README.md' || p === '/api-docs') {
    return fs.readFile(path.join(path.dirname(PUBLIC), 'README.md'), (err, data) => {
      if (err) return json(res, 404, { error: 'docs not found' });
      const html = '<!doctype html><meta charset="utf-8"><title>CONVERGENCE API</title>' +
        '<style>body{background:#0d1117;color:#e6edf3;font:14px/1.6 ui-monospace,monospace;' +
        'max-width:900px;margin:32px auto;padding:0 16px}pre{background:#161b22;padding:12px;' +
        'border-radius:6px;overflow-x:auto}a{color:#58a6ff}h1,h2,h3{color:#58a6ff}' +
        'table{border-collapse:collapse}td,th{border:1px solid #30363d;padding:4px 8px}</style>' +
        '<pre>' + String(data).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</pre>';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  }
  let file = p === '/' ? '/index.html' : p;
  const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(full, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'content-type': MIME[path.extname(full)] || 'application/octet-stream',
      'content-length': data.length,
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`CONVERGENCE on http://127.0.0.1:${PORT}`);
});

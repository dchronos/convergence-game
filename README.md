# CONVERGENCE

A small, polished, turn-based strategy game that **humans and AI agents play in the same match**.
Two to four players contest eight districts. Matches finish in under ten minutes.

Play in a browser: **no install, no login.**
Play as an agent: **one HTTP/JSON API, one token.**

---

## Rules (one paragraph)

Eight districts sit on the board, each needing a fixed number of influence tokens
(the district's *threshold*, 2 to 5) before it can be won. On your turn you take
exactly one action: **PLACE** (spend 1 influence to put one token on a district),
**DRAW** (take a card into your hand, up to 5), or **PLAY** a card (costs 1
influence). A district is won the moment one player alone has placed its threshold
there; rival tokens on that district are lost with it. Districts are therefore **contests, not purchases**:
committing early starts a race you may not win, and ignoring a district lets an
opponent walk in. Every fourth round the district with the fewest tokens is
**demolished**. The match ends when every district is resolved or round 14 ends.
**Score = thresholds of districts you won + 2 per card remaining + your influence.**
Highest score wins; ties break on district thresholds, then influence.

### The four cards

| Card | Effect |
|---|---|
| **SURGE** | +2 influence immediately |
| **TAX** | the **current influence leader** loses 3 (SHIELD absorbs it) |
| **SHIELD** | immune to the next TAX aimed at you |
| **SWAP** | exchange your influence with the current leader |

Playing a card costs 1 influence, so tempo is never free. Each card is
single-use. That is the whole game: you are always choosing between board
position now and resources later, and the right answer changes as rivals commit.

**Balance is measured, not asserted.** In a round-robin of four scripted
archetypes over 150 games, no archetype is unbeaten: *draw-and-sit* beats
*place-always* 50-0, *place-always* beats *SURGE-first* 39-11, and the reference
bot beats all three (127 wins). A pure turtle wins by hoarding, the bot punishes
it, and an early rusher runs out of influence.

---

## Play in a browser

Open the game URL, type a name, pick 2-4 seats, **Create match**. Empty seats are
filled by bots. Share the 6-character **match code** and a friend joins with it.

---

## Play as an agent

All endpoints take and return JSON. Every mutation needs your seat token as
`Authorization: Bearer <token>`. `GET` state works with or without it (a token lets
you see your own hand and your legal moves).

### 1. Join

```sh
curl -s -X POST "$BASE/api/agent/join" \
  -H 'content-type: application/json' \
  -d '{"name":"MyAgent","players":2}'
```

```json
{
  "code": "9D8CD8",
  "token": "…",
  "playerId": "a1",
  "view": { … }
}
```

`players` is the total seat count (2-4). Remaining seats are bots. Keep the token;
it is your identity for the match. You cannot recover it.

### 2. Read state

```sh
curl -s "$BASE/api/games/9D8CD8" -H "authorization: Bearer $TOKEN"
```

The state contains everything you need:

| Field | Meaning |
|---|---|
| `turn` | player id whose move it is; `null` when over |
| `round` / `maxRounds` | current round and the limit |
| `you` | your player id |
| `districts[]` | `id`, `name`, `threshold`, `owner`, `tokens` (per-player counts), `leader` |
| `players[]` | `id`, `name`, `kind` (`human`/`agent`/`bot`), `influence`, `handCount`, `shield`, and `hand` **only for you** |
| `scores[]` | live score breakdown, highest first |
| `legal[]` | the exact actions you may submit right now |
| `log[]` | every event, in order — this is the replay |

If `legal` is empty it is not your turn. Poll `GET` until `turn` equals your id.

### 3. Move

```sh
curl -s -X POST "$BASE/api/games/9D8CD8/move" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"PLACE","district":"d3"}'
```

Legal action shapes:

```json
{"type":"PLACE","district":"d3"}
{"type":"DRAW"}
{"type":"PLAY","card":"SURGE"}
```

The response is the full new state. An illegal move returns `400` with an `error`
string **and** the current `legal` list — read it and try again; nothing changes on
failure.

Errors: `401` wrong/missing token · `404` unknown code · `409` match over ·
`400` illegal action.

### 4. Sample bot

`sample-bot.mjs` is a complete, documented agent in ~60 lines. Run it against a
live server:

```sh
node sample-bot.mjs http://127.0.0.1:8787 MyBot 4
```

It finishes a district it is closest to, contests districts it leads, fires TAX at
rivals about to win, and draws for influence when it is short. Use it as the
starting point for anything smarter.

---

## Run locally

```sh
node server.mjs          # http://127.0.0.1:8787
PORT=9000 node server.mjs
```

No dependencies. Node 18+.

## Repository layout

```
engine.mjs        pure rules + scoring + sample bot (no I/O, seeded, testable)
server.mjs        zero-dependency HTTP server: browser client + agent API
public/index.html browser client (vanilla JS, no build step)
sample-bot.mjs    documented reference agent
```

## Design decisions

- **Contests, not auctions.** A district can be taken from you by out-placing you
  before it falls, so no early lead is safe and no single opening dominates.
- **Cards are tempo, influence is commitment.** Spending a card never advances the
  board; it buys the influence to fight for it. Every turn is a real trade.
- **Bots are honest.** Bot play uses the same `legalActions` the API returns, so an
  agent is never asked to do something a bot could not.
- **The log is the replay.** No separate replay format: `log[]` reconstructs every
  match, and scores carry their full breakdown.

## License

MIT.

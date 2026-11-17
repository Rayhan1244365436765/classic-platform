# Architecture

System design for the Casino Platform MVP. Scope of this document: how the pieces fit together,
how money is represented, and how fairness is proven. Database details live in
[DB_SCHEMA.md](./DB_SCHEMA.md).

> **Status:** **feature complete for the MVP** — API (**auth**, **wallet**, **roulette**, **manual
> payments**, **admin reporting/approval**) and all three clients (**web**, **Flutter**, **admin**).
> A real payment gateway (bKash etc.) is the next integration.

## 1. Tech stack

| Layer | Technology | Role |
| --- | --- | --- |
| API | **Node.js + Express 5 + TypeScript** | Single REST API, all business rules and money movements. |
| Database | **PostgreSQL 16** | Authoritative store: users, wallet ledger, game rounds. |
| Mobile client | **Flutter (Android)** | Player app for Android phones. |
| Web client | **React + Vite + TypeScript** | Player-facing browser app. |
| Admin client | **React + Vite + TypeScript** | Operator dashboard: users, ledger, rounds, config. |
| Docs | Markdown | Architecture, schema, setup. |
| Packaging | Docker Compose | PostgreSQL + backend for local development. |

Why a TypeScript API: one language across backend, web, and admin lets request/response types and
validation rules (`zod`) be shared, while PostgreSQL remains the only source of truth for money.

## 2. One REST API, three clients

The backend is a **stateless REST API**. Mobile, web, and admin never talk to PostgreSQL directly —
they hold no database credentials, so every rule (balance checks, payout math, authorization) is
enforced in exactly one place.

```
        ┌──────────────────┐
        │ Flutter (Android)│──┐
        └──────────────────┘  │
        ┌──────────────────┐  │  HTTPS / JSON      ┌────────────────────┐      ┌──────────────┐
        │  React web       │──┼───────────────────▶│  Express REST API  │─────▶│ PostgreSQL 16│
        └──────────────────┘  │   Bearer <JWT>     │  :3000             │  pg  │  :5432       │
        ┌──────────────────┐  │                    └────────────────────┘      └──────────────┘
        │  React admin     │──┘                              │
        └──────────────────┘                        JWT + role ('user' | 'admin')
```

**Rules that follow from this shape**

- **Shared API surface.** The same `POST /auth/login` serves all three clients; responses are plain
  JSON. Admin-only endpoints live under `/admin/*` and require `role = 'admin'`.
- **Stateless authentication.** `Authorization: Bearer <JWT>` signed with `JWT_SECRET`; no server
  session store. `userId` and `role` come from the token, never from the request body.
- **Role separation.** A player token can never call an admin route; an admin token is still bound to
  one user row.
- **Uniform error shape.** Every failure returns `{ "error": { "code", "message" } }` with a proper
  HTTP status, so all three clients handle errors identically.
- **Money is server-computed.** Clients submit *intents* (e.g. "spin 10 on the wheel"), never amounts
  to credit, and never a resulting balance.

Clients are deliberately thin:

| Client | Talks to | Code location for the HTTP layer |
| --- | --- | --- |
| Flutter | REST API | `mobile/lib/core/api/` |
| React web | REST API | `web/src/api/` (shared axios instance) |
| React admin | REST API | `admin/src/api/` (shared axios instance) |

### Implemented endpoints

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| `GET` | `/health` | – | `200 { "status": "ok" }` |
| `POST` | `/api/auth/register` | – | `201 { user: { id, phone, role } }` |
| `POST` | `/api/auth/login` | – | `200 { token, user: { id, phone, role } }` |
| `GET` | `/api/wallet/balance` | Bearer | `200 { balance }` |
| `POST` | `/api/wallet/deposit` | Bearer | `201 { transaction }` |
| `POST` | `/api/wallet/withdraw` | Bearer | `201 { transaction }` |
| `GET` | `/api/game/roulette/segments` | Bearer | `200 { segments, segmentCount, rtp, payouts }` — wheel layout + true odds |
| `POST` | `/api/game/roulette/play` | Bearer | `201 { segmentIndex, multiplier, segmentColor, won, payout, serverSeedHash, … }` |
| `GET` | `/api/game/slots/config` | Bearer | `200 { symbols, paytable, lines, cells, outcomes }` — symbol set, paylines, paytable |
| `POST` | `/api/game/slots/play` | Bearer | `201 { grid, winningLines, multiplier, won, payout, … }` |
| `GET` | `/api/game/dice/config` | Bearer | `200 { faces, multiplier, houseNumber, high, low }` — payout + winning ranges |
| `POST` | `/api/game/dice/play` | Bearer | `201 { roll, prediction, won, multiplier, payout, … }` |
| `GET` | `/api/game/aviator/config` | Bearer | `200 { growthTauMs, crashCap, minCashout }` — flight curve constants |
| `POST` | `/api/game/aviator/start` | Bearer | `201 { roundId, serverSeedHash, durationMs, … }` — debits the stake, crash point hidden |
| `POST` | `/api/game/aviator/cashout` | Bearer | `200 { status: 'cashed_out' \| 'crashed', multiplier, payout, crashPoint }` |
| `POST` | `/api/game/aviator/crash` | Bearer | `200 { status: 'crashed', crashPoint, payout: 0 }` — forfeits a flying round |
| `GET` | `/api/game/mines/current` | Bearer | `200 { game \| null }` — the board to resume |
| `GET` | `/api/game/mines/table` | Bearer | `200 { minesCount, multipliers[] }` — pay table per reveal count |
| `POST` | `/api/game/mines/start` | Bearer | `201 { gameId, minesCount, balanceAfter, … }` — debits the stake, hides the mines |
| `POST` | `/api/game/mines/reveal` | Bearer | `200 { status, multiplier, revealedTiles, mines? }` |
| `POST` | `/api/game/mines/cashout` | Bearer | `200 { status: 'won', multiplier, payout, mines }` |
| `GET` | `/api/game/plinko/config` | Bearer | `200 { rows, slots, multipliers, rtp }` — board + pay table |
| `POST` | `/api/game/plinko/play` | Bearer | `201 { path, slot, multiplier, payout, … }` |
| `GET` | `/api/game/keno/config` | Bearer | `200 { pool, drawn, minPicks, maxPicks, payTables[] }` — all 10 ladders |
| `POST` | `/api/game/keno/play` | Bearer | `201 { picked, drawn, matches, hits, multiplier, payout, … }` |
| `GET` | `/api/game/baccarat/config` | Bearer | `200 { payouts, rules, probabilities, rtp }` |
| `POST` | `/api/game/baccarat/play` | Bearer | `201 { playerHand, bankerHand, totals, winner, outcome, payout, … }` |
| `GET` | `/api/game/dragontiger/config` | Bearer | `200 { decks, shoeSize, payouts, probabilities, rtp }` |
| `POST` | `/api/game/dragontiger/play` | Bearer | `201 { dragonCard, tigerCard, ranks, winner, outcome, payout, … }` |
| `GET` | `/api/game/teenpatti/config` | Bearer | `200 { ranking, payouts, rake, odds }` |
| `POST` | `/api/game/teenpatti/play` | Bearer | `201 { playerHand, dealerHand, categories, winner, payout, … }` |
| `GET` | `/api/game/cascade/config` | Bearer | `200 { cols, rows, multipliers, symbols, pays, rtp }` |
| `POST` | `/api/game/cascade/play` | Bearer | `201 { grid, steps[], finalGrid, totalWin, payout, … }` |
| `GET` | `/api/game/classic_roulette/config` | Bearer | `200 { pockets, redNumbers, wheelOrder, payouts, rtp, houseEdge }` |
| `POST` | `/api/game/classic_roulette/play` | Bearer | `201 { pocket, pocketColor, won, multiplier, payout, wheelIndex, … }` |
| `GET` | `/api/game/fruit_bonanza/config` | Bearer | `200 { symbols, lines, pays, rtp, probabilities }` |
| `POST` | `/api/game/fruit_bonanza/play` | Bearer | `201 { grid, lines[], winningLines, multiplier, payout, … }` |
| `GET` | `/api/game/dice3d/config` | Bearer | `200 { dice, faces, outcomes, high, low, sums[] }` |
| `POST` | `/api/game/dice3d/play` | Bearer | `201 { dice[3], sum, triple, won, multiplier, payout, … }` |
| `GET` | `/api/game/boxing_king/config` | Bearer | `200 { symbols, pays, frequency, hitRate, rtp }` |
| `POST` | `/api/game/boxing_king/play` | Bearer | `201 { grid, clusters[], winningCells, multiplier, payout, … }` |
| `GET` | `/api/game/blackjack/current` | Bearer | `200 { game \| null }` — the hand to resume |
| `POST` | `/api/game/blackjack/start` | Bearer | `201 { gameId, playerHand, dealerHand(up-card), … }` |
| `POST` | `/api/game/blackjack/hit` | Bearer | `200 { playerHand, playerTotal, status, … }` |
| `POST` | `/api/game/blackjack/stand` | Bearer | `200 { dealerHand, dealerTotal, status, payout }` |
| `POST` | `/api/payment/deposit` | Bearer | `201 { payment }` — request only, no credit yet |
| `POST` | `/api/payment/withdraw` | Bearer | `201 { payment }` — debits the wallet immediately |
| `GET` | `/api/payment/mine` | Bearer | `200 { payments: [...] }` (own history) |
| `GET` | `/api/admin/stats` | Bearer + **admin** | `200 { totalUsers, totalWagered, totalPayouts }` |
| `GET` | `/api/admin/users` | Bearer + **admin** | `200 { users: [{ id, phone, role, balance, createdAt }] }` |
| `GET` | `/api/admin/transactions` | Bearer + **admin** | `200 { transactions: [{ id, phone, type, amount, status, referenceId, createdAt }] }` |
| `GET` | `/api/admin/payments` | Bearer + **admin** | `200 { payments: [...] }` — pending queue |
| `POST` | `/api/admin/payments/:id/approve` | Bearer + **admin** | `200 { payment }` (deposit → credit) |
| `POST` | `/api/admin/payments/:id/reject` | Bearer + **admin** | `200 { payment }` (withdraw → refund) |

Admin routes are guarded twice: `authGuard` (401 when the token is missing/invalid) then `adminGuard`
(403 `FORBIDDEN` when `req.user.role !== 'admin'`). Reporting is read-only; payment review moves money
exactly as described in [DB_SCHEMA.md §4](./DB_SCHEMA.md).

Spin (wheel) request body: `{ "betAmount": 10 }` — the segment decides the multiplier, so there is no
bet type to send (older `betType`/`betValue` fields are ignored). Errors: `400 VALIDATION_ERROR`,
`400 INVALID_BET_AMOUNT`, `400 INSUFFICIENT_FUNDS`.

Slots request body is the same shape — `{ "betAmount": 10 }` — because the reels decide the outcome.
`grid` is always a 9-element array (row-major 3×3), `winningLines` lists the paying rows (`[0]`,
`[1, 2]`, …), and `payout` is `betAmount × winningLines.length × 8.4`.

Dice adds the call: `{ "betAmount": 10, "prediction": "high" }` (`"low"` also valid — anything else is
`400 VALIDATION_ERROR`). `roll` is 1–100, `won` is `roll > 50` for high / `roll < 50` for low, and a
win pays `betAmount × 1.95`.

Aviator is a two-step round: `POST /start { betAmount }` returns `{ roundId, durationMs }` (the crash
point stays hidden), then `POST /cashout { roundId, multiplier }`. `multiplier` is optional and is
treated as a *cap*: the server pays `min(claim, e^(serverElapsed / growthTauMs))`, so a late or
inflated claim cannot win. A round that has already burst returns `{ status: 'crashed', payout: 0 }`;
`POST /crash { roundId }` forfeits a flying round so it is never left `pending`.

Mines is turn-based: `POST /start { betAmount, minesCount }` returns only `{ gameId, … }` (never the
board), `POST /reveal { gameId, tileIndex }` opens one tile, and `POST /cashout { gameId }` settles.
The mine positions are disclosed only once the game is over, and `GET /current` lets a reloaded page
re-attach to a board that is still open. One board at a time per player: a second `start` returns
`409 GAME_IN_PROGRESS`.

Plinko is instant: `POST /play { betAmount, rows: 8 }` returns the ball's route (`path`), the landing
`slot`, the `multiplier` and the `payout` — the client replays that exact path as an animation, so the
visual can never disagree with what was paid.

Keno is instant as well: `POST /play { betAmount, selectedNumbers }` takes 1–10 distinct numbers from
1–80, draws 20 and returns `{ picked, drawn, matches, hits, multiplier, payout }`. The hits are counted
and priced on the server; the board only replays the draw one ball at a time.

Baccarat is instant: `POST /play { betAmount, betOn }` (`'player' | 'banker' | 'tie'`) returns both
hands, both totals, the winner and the settlement — the client replays the deal, so the felt can never
disagree with what was paid.

Dragon Tiger is the same shape and one card lighter: `POST /play { betAmount, betOn }`
(`'dragon' | 'tiger' | 'tie'`) returns `{ dragonCard, tigerCard, dragonRank, tigerRank, winner,
outcome, multiplier, payout }`.

Teen Patti takes no side — `POST /play { betAmount }` deals three cards each and returns
`{ playerHand, dealerHand, playerCategory, dealerCategory, winner, outcome, multiplier, payout }`,
where the categories are `trail | pureSequence | sequence | colour | pair | high`.

Showdown is the only game that returns a **chain**: `POST /play { betAmount }` sends back the opening
`grid`, one `steps[]` entry per cascade (the grid it paid on, the `clusters` with their cells and pays,
the `removed` cells, and that step's `multiplier`), the `finalGrid`, and the `totalWin` in bet multiples.
The client replays the chain, so the animation cannot invent a win.

Blackjack is turn-based like Mines: `POST /start { betAmount }` deals and returns your hand plus **only
the dealer's up-card** (no hole card, no shoe), `POST /hit { gameId }` takes one card, and
`POST /stand { gameId }` plays the dealer out. `GET /current` re-attaches a reloaded page to an open
hand; a second `start` while one is live returns `409 GAME_IN_PROGRESS`.

**Rules / economics.** Win = **2× the bet**, push = stake returned, loss = nothing; the dealer draws to
**17+** (stands on soft 17); naturals settle immediately at `start` (both → push). There are no
doubles or splits. Simulated over 300k hands with a "hit below 17" strategy
(`backend/scripts/verify-blackjack.cjs`): win 41.15% / loss 49.38% / push 9.47%, naturals 4.84% →
**RTP 91.77% (house edge 8.23%)**. Paying a natural 3:2 (2.5×) instead of even money would add
≈2.4 points (≈94.2% RTP) — a one-line change in `settle()`/`startGame()` if you want it.

Wallet request bodies are `{ "amount": 10.5 }` (positive, 2-dp). Errors: `400 INVALID_AMOUNT`,
`400 INSUFFICIENT_FUNDS`, `404 USER_NOT_FOUND`, `401 UNAUTHORIZED`.

Auth request bodies are `{ "phone": "…", "password": "…" }` (phone ≥ 10 chars, password ≥ 6 chars,
validated by `zod`). Errors always use `{ error: { code, message } }` — `400 VALIDATION_ERROR`,
`401 INVALID_CREDENTIALS`, `409 PHONE_ALREADY_EXISTS`, `500 INTERNAL_ERROR`.

Authentication flow: `bcrypt` (cost 10) hashes the password on register; login verifies it and signs a
JWT (`{ id, role }`, `7d`) with `JWT_SECRET`. Protected routes use
`common/middleware/authGuard.ts`, which validates `Authorization: Bearer <token>` and sets
`req.user = { id, role }`, returning `401 UNAUTHORIZED` otherwise.
## 3. Wallet ledger

### The rule

> **We never update a user's balance.** There is no `balance` column on `users`. Every money movement
> is a row in `transactions`, and the balance is the **SUM** of those rows.

```
balance(user) = Σ transactions.amount   WHERE user_id = user AND status = 'completed'
```

| `type` | Sign | Meaning |
| --- | --- | --- |
| `deposit` | **+** | Player tops up via a payment provider. |
| `win` | **+** | Payout credited after a won round. |
| `bet` | **−** | Stake debited when a round starts. |
| `withdraw` | **−** | Player cashes out. |

Amounts are `NUMERIC(18,2)` (never floats). The sign is enforced by a `CHECK` constraint, so a `bet`
row can never accidentally credit the wallet.

### A wheel spin in ledger terms

The multiplier applies to the stake, so a 10.00 spin that lands on 2× pays 20.00 (stake back +
10.00 profit). After settling, `transactions` holds two rows linked by the same `reference_id` (the
round id):

| type | amount | reference_id |
| --- | --- | --- |
| `bet` | `-10.00` | `round-id` |
| `win` | `+20.00` | `round-id` |

A 0× spin writes only the `bet` row (the whole stake is lost). A `1×` segment writes both rows but
nets to zero, and `0.5×` credits half the stake back. The balance is recomputed by summation —
nothing is mutated in place.

### Why append-only?

- **Audit trail** — every cent is explainable by a row; nothing is silently overwritten.
- **Concurrency safety** — `UPDATE users SET balance = balance - 10` loses updates under concurrent
  bets (and can push a balance negative). Inserting rows cannot race that way.
- **Reversibility** — a mistaken movement is corrected with a compensating row, preserving history.
- **Reconciliation** — `reference_id` matches ledger rows to payment-provider records or game rounds.
- **Reporting** — admin analytics are plain SQL aggregates over the ledger (`deposit_total`,
  `ggr = wins − bets`, …) instead of derived counters that can drift.

### Money flow for a manual request

`payment_requests` holds player-initiated deposits/withdrawals that an operator reviews:

| Request | On approval | On rejection |
| --- | --- | --- |
| `deposit` | a `deposit` ledger row credits the wallet | nothing was written, nothing to undo |
| `withdraw` | nothing (the debit already happened when it was filed) | a compensating `deposit` row refunds the wallet |

A withdrawal is debited **immediately** as a *completed* `withdraw` row: the ledger only counts
`completed` rows toward a balance, so a `pending` transaction would leave the money spendable twice.
The "waiting for approval" state lives on `payment_requests.status`, and rows are locked
(`SELECT … FOR UPDATE`) during review so two admins cannot double-approve.

### Invariants

1. `transactions` rows are **immutable** — no `UPDATE`/`DELETE` in normal operation.
2. Only `status = 'completed'` rows count toward the balance; `pending` deposits cannot be staked.
3. A bet's `bet` row and its `win` row share one `reference_id` and are written in one DB transaction.
4. Corrections are new rows (e.g. a future `refund` type), never edits.
5. Balance is **read** from the sum, optionally via the `account_balances` view — see
   [DB_SCHEMA.md](./DB_SCHEMA.md#5-account_balances-derived-view).
6. A withdrawal locks the user's row (`SELECT … FOR UPDATE`) before summing, so two concurrent debits
   cannot both pass the funds check and overdraw the ledger.

Trade-off accepted for the MVP: summation is O(n) per user. This is fine at MVP volumes (with
`idx_transactions_user_created`), and if it ever becomes hot the answer is a *periodic snapshot* row
plus the sum of rows after it — an append-only ledger stays intact either way.
## 4. Provably fair RNG (HMAC-SHA256)

Goal: a player must be able to prove that a spin's outcome was fixed *before* the bet and was not
tuned afterwards — without the server leaking the seed in advance.

### Commit → spin → reveal

1. **Commit.** The server generates a random `server_seed` (32 bytes, hex) and publishes
   `server_seed_hash = SHA256(server_seed)` to the player *before* the round starts. This hash is
   exactly the `game_rounds.server_seed_hash` column.
2. **Spin.** The outcome derives deterministically from the seed material:

   ```
   message  = client_seed + ":" + nonce
   digest   = HMAC-SHA256(key = server_seed, message)    # hex
   value    = int(digest[0:8], 16)                       # first 8 hex chars
   fraction = value / 0xFFFFFFFF                         # [0, 1]
   number   = min(floor(fraction * 37), 36)              # pockets 0..36
   ```

   `0xFFFFFFFF` is the *inclusive* maximum of an 8-hex slice, so a digest starting `ffffffff` gives
   exactly `1.0` → `37`, which is not a pocket; that 1-in-4-billion case is clamped to `36`.

   `client_seed` is public input and `nonce` distinguishes rounds. **MVP:** a random client seed and
   `nonce = 1` are used per round; per-player seed history and a user-supplied client seed come later.
3. **Reveal.** After the round is settled the server reveals `server_seed`. The player recomputes
   `SHA256(server_seed)` (must equal the committed hash) and re-runs the HMAC to reproduce the exact
   number. A seed is retired once revealed.

```
  before bet          during round              after settle
  ──────────          ────────────              ────────────
  seed (secret)  ──▶  outcome = HMAC(...)  ──▶  seed revealed
  hash published      hash unchanged            hash must match
```

### Why this design

- **Binding** — the published hash binds the server to a single seed (hash preimage resistance).
- **Deterministic** — same seed + same client seed + same nonce ⇒ same number, every time.
- **Player-influenced** — the server cannot precompute outcomes for a client seed it does not know.
- **Verifiable by anyone** — verification needs only SHA-256/HMAC, no trust in our code.
- **Crypto, not `Math.random()`** — no PRNG state, no seed-guessing, reproducible across languages
  (Node `crypto`, `dart:crypto`, Web Crypto).

**Current state:** implemented in `backend/src/common/provably-fair/index.ts` —
`generateServerSeed()` (32 random bytes → 64 hex), `generateClientSeed()`,
`hashServerSeed()` (`SHA256`, lowercase hex, validated by the
`game_rounds_server_seed_hash_check` constraint) and `generateProvablyFairIndex()`, which maps the
HMAC digest to an index in `[0, slots)`.

**Fairness caveat for the MVP:** the house edge comes from the segment table, not from biasing the
RNG. `WHEEL_SEGMENTS` (20 slots) is
`[10, 0, 0.5, 0, 0, 2, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0]`, i.e. fourteen 0×, four
0.5×, one 2× and one 10×. Because

```
RTP = Σ multipliers / segment count = (0×14 + 0.5×4 + 2 + 10) / 20 = 14 / 20 = 70%
```

the house edge is **30%** — change the array and you change the economics, so keep
`backend/src/modules/game/roulette/roulette.service.ts` and the clients' wheel rendering in sync
(the layout is served by `GET /api/game/roulette/segments` for exactly that reason).

**Lucky Slots** (`backend/src/modules/game/slots/`) is a 3×3 grid (9 reels) with three horizontal
paylines (rows: cells `0‑2`, `3‑5`, `6‑8`). All nine cells come from **one** digest:
`generateProvablyFairIndex(…, 6⁹ = 10,077,696)` → nine base-6 digits, so every cell is an
independent 1-in-6. `evaluateGrid()` marks each row of three identical symbols as a paying line, and
each line pays `SLOT_PAYTABLE.lineMultiplier` (8.4×) of the **total** stake — the stake covers the
whole spin, so all three lines pay 25.2×.

```
P(line is 3 alike) = 6 / 6³ = 1/36
RTP = lines × P(line) × lineMultiplier = 3 × (1/36) × 8.4 = 0.70   → house edge exactly 30%
```

`slotsRtp()` derives that number from the constants, and `scripts/verify-slots.cjs` prints it. Note
that a 6× line multiplier (an earlier suggestion) yields only `3 × 6/36 = 50%` RTP; 8.4× is what
pins the edge at 30%. Because a line hits ~2.8% of the time, roughly 92% of spins are losers — that
is the direct consequence of a 70% RTP with only 3 paylines. Odds are never shown to the player.

**Dice (High/Low)** (`backend/src/modules/game/dice/`) rolls `generateProvablyFairIndex(…, 100) + 1`
→ 1–100. HIGH wins on 51–100, LOW wins on 1–49, and **50 loses for both sides**. A win pays 1.95×,
so the two sides do not have the same edge:

```
HIGH: 50/100 × 1.95 = 97.50% RTP → 2.50% house edge
LOW : 49/100 × 1.95 = 95.55% RTP → 4.45% house edge
```

`diceRtp('high' | 'low')` reports both. The asymmetry is structural (50 is a losing square for both
calls); to equalise, pay LOW 1.99× (`0.49 × 1.99 = 97.51%`) or make 50 a push.

**Mines** (`backend/src/modules/game/mines/`) is a 5×5 board whose mine layout is a provably-fair
Fisher–Yates shuffle of the 25 cells (seed committed at `start`, layout disclosed only on settle).
The pay table is the standard hypergeometric one with a fixed 3% edge:

```
fair(k)       = C(25, k) / C(25 − M, k)      // k gems opened, M mines
multiplier(k) = floor(fair(k) × 0.97, 2dp)   // 1.10× 1.25× 1.44× … for 3 mines
```

Since `P(opening k gems) = 1 / fair(k)`, the expected return is **0.97 at every cash-out point**
(measured 96.6–97.0% after 2dp flooring) — the edge does not depend on how greedy the player is.
The multiplier is always recomputed server-side from the number of revealed tiles, and
`reveal`/`cashout` take a row lock (`FOR UPDATE`) so concurrent clicks cannot double-settle.

**Plinko** (`backend/src/modules/game/plinko/`) drops a ball through 8 rows of pegs. One digest picks
an index over all 2⁸ = 256 routes; its bits are the L/R steps, so every route is equally likely and
the landing slot follows Binomial(8, ½) — the slot is simply the number of “right”s.

```
multipliers = [5.49, 2.05, 1.08, 0.98, 0.49, 0.98, 1.08, 2.05, 5.49]
Σ C(8,k)·m_k = 248.32   ⇒   RTP = 248.32 / 256 = 0.9700   (3% edge)
```

(The usual `[5.6, 2.1, 1.1, 1, 0.5, …]` table only reaches 98.9%, so it was rescaled to land exactly
on 97%.) Because every slot pays something, each drop writes both a `bet` and a `win` ledger row.

**Keno** (`backend/src/modules/game/keno/`) draws 20 of 80 and pays on how many of the player's 1–10
picks are among them. If `k` of `n` picks are drawn, `k` is **hypergeometric** — draws are without
replacement, so the catches are not binomial:

```
P(k | n) = C(20, k) · C(60, n − k) / C(80, n)
```

The ladder is derived rather than hard-coded: walk the catch levels up from 1 and keep the most
generous threshold `t` whose lowest prize still returns **at least the stake**, spread the remaining RTP
geometrically (`w(k) = 3^(k − t)`), scale so `Σ P(k)·m(k) = 0.97`, then floor to 2dp so rounding can
only move the edge *towards* the house.

```
picks  1 | 1→3.88                                               RTP 97.00%
picks  5 | 2→1.49  3→4.48  4→13.46  5→40.38                     RTP 96.78%
picks 10 | 4→2.10  5→6.31  6→18.93  7→56.81  8→170.45
         | 9→511.35  10→1534.05                                 RTP 96.91%
```

The intuitive table (10 picks: `5→1×, 6→2×, 7→5×, 8→20×, 9→50×, 10→100×`) returns only **8.55%** — a
91.45% edge — because `P(4 of 10) = 14.73%` forces most of the money back through the low catches; a 3%
edge needs a real jackpot (10 of 10 is a 1-in-8.9-million event). `GET /config` publishes all ten
ladders, so the printed paytable is always the one that settled the round.

The draw itself is a partial Fisher–Yates shuffle: one digest per ball picks a partner from the
untouched tail, so the span shrinks every step (no repeats) and every ordered 20-subset is equally
likely. Verified by `backend/scripts/verify-keno.cjs` and `backend/scripts/keno-smoke.ps1`.

**Baccarat** (`backend/src/modules/game/baccarat/`) is one 52-card deck dealt Player-Banker-Player-Banker.
Card values are A = 1, 2–9 face, T/J/Q/K = 0, and every total is **mod 10** (7 + 8 = 5). Either side on
8–9 after two cards is a natural (both stand); Player draws on 0–5; Banker follows the standard tableau
keyed to the value of the player's third card (0–2 always, 3 unless the player drew an 8, 4 on 2–7, 5 on
4–7, 6 on 6–7, 7 stands).

The "simplified" variant — both sides draw on 0–5 — was rejected because it makes the game **exactly
symmetric**: enumerating the value sequences gives `P(player) = P(banker) = 45.3909%`, so the 2× Player
payout would be a **100.00% RTP**, i.e. a zero-edge free bet. The tableau restores the asymmetry that the
5% bank commission exists to price.

A tie **pushes** Player and Banker bets (standard Punto Banco). Odds are computed exactly at runtime by
`baccaratProbabilities()` — the game is summed over value sequences (16 zeros + four of each 1–9), not
simulated:

```
P(player) 44.6760%   P(banker) 45.9624%   P(tie) 9.3615%     (sum = 1.000000)

Player  2×     →  P(tie) + 2·P(player)     = 98.71% RTP  (1.29% edge)
Banker  1.95×  →  P(tie) + 1.95·P(banker)  = 98.99% RTP  (1.01% edge)
Tie     8×     →  8·P(tie)                 = 74.89% RTP  (25.11% edge)
```

Those are real baccarat numbers (8-deck: 98.76 / 98.94 / 85.6). The tie bet is thin because 8× is paid on
a 9.36% event; paying 9× — the usual 8:1 profit — would raise it to 84.25%. Verified by
`backend/scripts/verify-baccarat.cjs` and `backend/scripts/baccarat-smoke.ps1`.

**Dragon Tiger** (`backend/src/modules/game/dragontiger/`) deals one card each and compares ranks
(A = 1 … K = 13); equal ranks of any suit are a tie, and a tie **loses** Dragon and Tiger bets, so only
the Tie bet collects. Only P(tie) depends on the shoe — everything else follows by symmetry:

```
P(tie)  = 13 · (perRank / total) · ((perRank − 1) / (total − 1))
P(side) = (1 − P(tie)) / 2

one deck     P(tie) 5.8824%   P(dragon)=P(tiger) 47.0588%
eight decks  P(tie) 7.4699%   P(dragon)=P(tiger) 46.2651%   ← implemented

Dragon/Tiger 2×  →  92.53% RTP   (7.47% edge)
Tie          8×  →  59.76% RTP   (40.24% edge)
```

The spec prices 8× as "standard for an 8-deck game", so the table deals from the standard 8-deck shoe
and both stated multipliers are honoured; `DRAGON_TIGER_DECKS` is the only knob (one deck → 94.12% on the
sides, but the tie falls to 47.06%). Paying the tie 9× — 8:1 profit, the live casino price — would lift it
to 67.23% (32.77% edge), and real Dragon Tiger takes only *half* a side bet on a tie, which is why its
side bets sit at 96.27% instead of 92.53%.

The deal is a partial Fisher–Yates over the shoe (two digests, uniform over ordered pairs). Verified by
`backend/scripts/verify-dragontiger.cjs` and `backend/scripts/dragontiger-smoke.ps1`.

**Teen Patti** (`backend/src/modules/game/teenpatti/`) deals three cards each. Ranking, best first:
**trail** → **pure sequence** → **sequence** → **colour** → **pair** → **high card**; aces are high,
A-2-3 is the lowest run and Q-K-A the highest, and suits never break a tie.

Both hands come from the same deck, so the match is perfectly symmetric. With the spec's even-money win
and refunded tie:

```
2·P(win) + 1·P(tie) = (1 − t) + t = 1.0000     → a zero-edge free bet
```

Ties are rare — P(tie) = **0.1106%**, so the refund contributes almost nothing — which is why the table
carries a **5% rake on the win**: 2× less 5% of the 1× profit = **1.95×**, the same treatment baccarat
gives the Banker.

```
P(tie) 0.1106%   P(player) = P(dealer) 49.9447%
win 1.95× →  1.95·0.499447 + 0.001106 = 97.50% RTP   (2.50% edge)
win 2.00× →  2·0.499447 + 0.001106    = 100.00% RTP  (0.00% edge, the literal spec)
```

`TEEN_PATTI_RAKE = 0` restores the literal 2× and the zero-edge table. Hand frequencies, straight from the
same enumeration: trail 0.24%, pure sequence 0.22%, sequence 3.26%, colour 4.96%, pair 16.94%, high card
74.39%.

`teenPattiOdds()` recomputes the odds at runtime rather than trusting a constant: it enumerates all 22,100
hands, groups them by score and counts the **card-disjoint** pairs inside each group (two hands can only tie
when they share no card) — 450,528 tie pairs out of 407,170,400 ordered deals. That is also how the hand
evaluator is regression-tested: `backend/scripts/verify-teenpatti.cjs` reproduces every number, and
`backend/scripts/teenpatti-smoke.ps1` re-scores 80 live hands with an independent implementation.

**Showdown** (`backend/src/modules/game/cascade/`) is the cluster-pays slot: a 5×4 grid of seven Wild West
symbols where **3+ orthogonally adjacent** identical symbols form a cluster. Winning cells are removed,
survivors drop, fresh symbols fill the top, and every extra tumble **doubles** the multiplier — ×1, ×2, ×4,
×8, ×16, capped at five cascades.

Tiers, low to high: 🥃 whiskey · 🤠 hat · 🔫 gun · 🐎 horse · ⭐ badge · 💥 dynamite · 🔥 fire. Paytable (bet
multiples by cluster size 3, 4, 5, 6, 7, 8+):

```
           3     4     5     6      7      8+
🥃      0.06  0.12  0.25  0.47   0.82   1.40
🤠      0.07  0.15  0.30  0.59   1.07   1.75
🔫      0.09  0.19  0.37  0.72   1.28   2.13
🐎      0.12  0.25  0.47  0.94   1.63   2.57
⭐      0.16  0.31  0.59  1.19   2.13   3.51
💥      0.34  0.72  1.40  2.82   4.69   7.64
🔥      0.59  1.19  2.35  4.69   8.20  14.08
```

A cascade chain is not analytically tractable — every refill is a fresh 20-cell state — so the table is
**tuned by simulation** (`backend/scripts/verify-cascade.cjs`, 3,000,000 rounds):

```
RTP 95.72%   hit rate 79.60%   avg 1.676 cascades   max win 133× bet
cascades: 0 20.4% · 1 33.2% · 2 22.4% · 3 12.2% · 4 6.1% · 5 5.7%
```

Re-theming to seven symbols **changed the maths**: the previous 8-symbol ladder carried straight over paid
148.31% (fewer distinct symbols ⇒ far more clusters), so the pays were re-scaled from a measured baseline and
the RTP re-measured from scratch. `CASCADE_RTP` holds that figure beside the table, `/config` publishes it, and
`backend/scripts/verify-cascade-service.mjs` re-runs the simulation through the *shipped* cluster/collapse
functions (plus unit checks for L-shaped clusters, diagonal non-connection and column refills).
`backend/scripts/cascade-smoke.ps1` then re-derives every cluster, pay, step win and the payout from 300
live spins.

**Classic Roulette** (`backend/src/modules/game/classic_roulette/`) is the real single-zero table: 37
pockets (0–36), **0 green**, the canonical 18 red numbers (`1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36`)
and 18 black. `POST /play { betAmount, betType, betValue? }` takes one bet per spin:

| `betType` | wins on | payout | RTP |
| --- | --- | --- | --- |
| `number` | that one pocket | 36× | (1/37)×36 = **97.30%** |
| `red` / `black` | 18 pockets | 2× | (18/37)×2 = **97.30%** |
| `even` / `odd` | 18 pockets | 2× | (18/37)×2 = **97.30%** |
| `low` (1–18) / `high` (19–36) | 18 pockets | 2× | (18/37)×2 = **97.30%** |

Unlike the other tables nothing had to be tuned: with no *la partage* / *en prison* rule the single zero is
the entire edge, so **every** bet on the board returns 36/37 and the house edge is 1/37 = 2.70% — the lowest
on the platform. `rouletteRtp()` derives it from the pocket count and the paytable (never a constant),
`classicRouletteConfig()` publishes the same figures plus the physical `wheelOrder`, and
`backend/scripts/verify-classic-roulette.cjs` re-derives them by enumerating all 37 pockets instead of
sampling. Zero is the interesting case: it loses `red`, `black`, `even`, `odd`, `low` and `high` outright
(which is exactly why the even-money bets cannot pay 18/37 × 2 = 100%).

The wheel is drawn from the real clockwise pocket order, and the response carries `wheelIndex` — the pocket's
position in that order — so the client can rotate the winning slot under the marker instead of guessing an
angle: the animation is derived from the settled result, never from a local spin. One wallet transaction
debits the stake, credits `betAmount × 36` or `betAmount × 2`, and writes a `game_rounds` row
(`bet_type='classic_roulette'`, `bet_value='number:17'`/`'red'`, `result='17|black'`).
`backend/scripts/classic-roulette-smoke.ps1` replays 217 live spins (all 37 straight numbers plus 30 of each
outside box) and re-checks the colour, winner, multiplier, payout and balance from an independent
implementation of the layout.

**Fruit Bonanza** (`backend/src/modules/game/fruit_bonanza/`) is a 3×3 fruit slot with five paylines —
three rows plus both diagonals — and six symbols (`🍉 🍇 🍋 🍒 🍊 ⭐`). Nine independent 1-in-6 draws
(cell `i` uses nonce `1 + i` of one committed seed pair) fill the grid, and every winning line pays on the
full bet, the same convention Lucky Slots uses:

| line | pays |
| --- | --- |
| 3 identical | **4×** the bet |
| exactly 2 identical | **0.2×** the bet |
| all different | nothing |

```
P(3 alike)     = 6/216 = 1/36    = 2.7778%
P(exactly two) = 90/216 = 5/12   = 41.6667%
P(all differ)  = 120/216 = 5/9   = 55.5556%

line EV = 4 × 1/36 + 0.2 × 5/12 = 7/36
RTP     = 5 lines × 7/36 = 35/36 = 97.2222%   (house edge 2.78%)
```

**The brief's 10× / 2× could not ship.** A line returns 10 × 1/36 + 2 × 5/12 = 1.111× its stake, so a
five-line spin pays **555.6%** on average — a money printer. Because a pair lands on 41.7% of lines, pairs
dominate the return, so the table was re-derived to 4× / 0.2×, which keeps every requested feature (five
lines, a big triple prize, a small pair prize) and lands on exactly 35/36. Overlapping lines do not disturb
that figure: expectation is linear, so the mean of a sum of five lines is the sum of their means.

`backend/scripts/verify-fruit-bonanza.cjs` proves it by enumerating **all 6⁹ = 10,077,696 grids** (no
sampling): exact RTP 0.972222222, 95.0465% of spins win something, 13.1572% contain a triple, 2.083 pair
lines per spin, maximum 20× (all nine cells identical). The same script re-scores 20,000 random grids
against `evaluateFruitGrid()`, and `backend/scripts/fruit-bonanza-smoke.mjs` replays 200 live spins,
re-deriving every line, the multiplier, the payout and the ledger balance from an independent scorer. The
cabinet (`web/src/pages/FruitBonanza.tsx`) rolls all nine reels for ~1.5 s, locks them one at a time 110 ms
apart, glows the cells of every paying line and lists the lines that paid.

**3D Dice** (`backend/src/modules/game/dice3d/`) rolls three dice (nonces 1–3 of one committed seed
pair) and settles a bet on their total: **high** (11–18), **low** (3–10) or an **exact total** (3–18). The
6³ = 216 outcomes are not flat:

```
total   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18
combos  1   3   6  10  15  21  25  27  27  25  21  15  10   6   3   1
```

**Two fixes to the brief's payouts.** Each half of the board holds exactly 108 of the 216 rolls — 50 % — so
`2×` would be a **100 % RTP** free bet; the standard Sic Bo rule is used instead: **a triple loses high and
low** (a triple is never "big" or "small"), leaving 105 winning rolls per side:

```
high/low RTP = 2 × 105/216 = 210/216 = 35/36 = 97.22%
```

A flat `12×` on every total also cannot work — it returns 150 % on 10/11 (27 combos) and 5.6 % on 3/18
(1 combo). Each total therefore pays `210/combos`, so every square returns exactly 35/36 except 10/11, which
take the nearest round number:

```
total    3/18  4/17  5/16  6/15  7/14  8/13  9/12  10/11
pays     210×   70×   35×   21×   14×   10×   8.4×   7.8×
RTP     97.22% 97.22% 97.22% 97.22% 97.22% 97.22% 97.22% 97.50%
```

`backend/scripts/verify-dice3d.cjs` enumerates all 216 rolls and compares every one of the 18 bet types
against an independent scorer (3,888 comparisons), and `backend/scripts/dice3d-smoke.mjs` replays live rolls,
re-deriving the sum, the triple rule, the multiplier, the payout and the ledger balance.

The page (`web/src/pages/Dice3D.tsx`) is a real 3D scene: `perspective` on the felt, and each die a
`preserve-3d` cube with six pip faces (opposite faces summing to seven). Crucially, **every tumble keyframe is
prefixed with the die's settled pose** (`var(--die-settle)`), so a lap starts and ends exactly where the die
will land — the hand-over to the landing bounce has no orientation snap. Each die tumbles at its own speed
(620–840 ms/rev), the three land 160 ms apart, and the settle rotation is chosen so the rolled value faces the
camera (checked numerically, not by eye, in the page's geometry test).

**Boxing King** (`backend/src/modules/game/boxing_king/`) is a 3×3 cluster-pays slot: nine independent
1-in-6 draws over `🥊 🏆 🤴 💪 💥 🩳`, and a win is **any 3+ identical symbols joined horizontally or
vertically** (diagonals do not connect). Every cluster pays and the pays add up, so a board can hold up to
three separate clusters (the measured maximum).

| cluster | pays |
| --- | --- |
| 3–4 symbols | **2×** |
| 5–6 symbols | **8.5×** |
| 7+ symbols | **30×** |

Cluster frequency on a 3×3 board is not analytic — shapes overlap, stack and merge — so
`backend/scripts/verify-boxing-king.cjs` **enumerates all 6⁹ = 10,077,696 boards** with an independent flood
fill and reports:

```
E[clusters of 3-4] = 0.380295     E[clusters of 5-6] = 0.023354     E[clusters of 7+] = 0.000504
hit rate (>= 1 cluster) = 37.87%     max 3 clusters on one board     biggest possible cluster = 9

RTP = 2 × 0.380295 + 8.5 × 0.023354 + 30 × 0.000504 = 97.42%
```

**The brief's 2× / 5× / 15× returns only 88.5%** — an 11.5% house edge, roughly four times the platform's
norm — so the two rare tiers were raised while the common 3–4 tier keeps its 2×. The measured frequencies are
baked into the service so the RTP is a closed form, and the verifier asserts they still match the real board
(the constants cannot drift), plus unit shapes (row, L, +, two clusters, diagonal rejected, pair rejected) and
a 20,000-board comparison against the service's DFS. `backend/scripts/boxing-king-smoke.mjs` then replays live
rounds, recomputing every cluster with a **union-find** over the twelve orthogonal edges.

The page (`web/src/pages/BoxingKing.tsx`) puts the board on a boxing canvas inside ropes and corner posts.
Nine reels roll for ~1.5 s and lock 110 ms apart, then every cell of a paying cluster **throws a punch** —
scale up, shake, red glow, red text-shadow — and a cluster of 5+ sets off an eighteen-spark burst.

**Aviator** (`backend/src/modules/game/aviator/`) commits a crash point at `start` and never sends it:

```
u          = provablyFairFloat ∈ [0, 100)
crashPoint = max(1, (100 / (100 − u)) × 0.95)   // 2dp, capped at 100x
multiplier(t) = e^(t / 5500ms)                  // flight = 5500·ln(crashPoint) ms
⇒ P(crash ≥ m) = 0.95 / m  ⇒  EV(cash out at m) = m·P − 1 = −5%
```

so the edge is 5% at **every** cash-out point (`scripts/verify-aviator.cjs` prints the table plus an
empirical sweep: P(crash = 1.00) ≈ 5.9%, P(crash > 2) ≈ 47.3% — 2dp flooring and the 100× cap only
ever move money toward the house).

*Settling is server-authoritative.* The API returns `durationMs` so the client can animate the burst
(and call `/crash` to close the round), but `cashOut()` re-derives the elapsed time from
`now() − started_at`: once that passes the flight time the round is recorded as `crashed` with no
payout, and a successful cash-out pays `min(clientClaim, e^(elapsed/τ))`. A client that knows the
crash time therefore still cannot win — verified by claiming `50x` 0.7 s into a round and being paid
`1.16x`.

**Still missing:** the reveal endpoint (`GET /api/game/roulette/rounds/:id/reveal`) and storing
`client_seed`/`nonce` per round. Until then a player can verify the committed hash but not recompute
the spin themselves.

## 5. Backend module map

```
backend/src/
├── config/
│   ├── db.ts             # pg Pool + query() + withTransaction()
│   └── env.ts            # PORT, DATABASE_URL, JWT_SECRET
├── modules/
│   ├── auth/             # IMPLEMENTED: register, login, JWT issue/verify
│   ├── wallet/           # IMPLEMENTED: ledger writes, balance reads, deposit/withdraw
│   ├── game/roulette/    # IMPLEMENTED: 20-segment "Spin to Win" wheel (RTP 70%), atomic settle
│   ├── game/slots/       # IMPLEMENTED: 3×3 Lucky Slots, 3 paylines, one draw per spin
│   ├── game/dice/        # IMPLEMENTED: High/Low roll 1–100 at 1.95×, 50 loses
│   ├── game/mines/       # IMPLEMENTED: 5×5 board, hidden layout, 3% edge, own table
│   ├── game/plinko/      # IMPLEMENTED: 8-row peg board, 97% RTP, instant settle
│   ├── game/keno/        # IMPLEMENTED: 20 of 80, 1–10 picks, derived 97% ladders
│   ├── game/baccarat/    # IMPLEMENTED: single deck, full tableau, tie pushes, exact RTP
│   ├── game/dragontiger/ # IMPLEMENTED: 8-deck shoe, one card each, tie loses the sides
│   ├── game/teenpatti/   # IMPLEMENTED: 3 cards each, 6-category ranking, 5% rake, exact odds
│   ├── game/cascade/     # IMPLEMENTED: 5×4 cluster-pays slot, Wild West set, ×1→×16, 95.72% RTP
│   ├── game/blackjack/   # IMPLEMENTED: single-deck 21, hit/stand, own table
│   ├── game/aviator/     # IMPLEMENTED: crash rounds, hidden point, server-authoritative cash-out
│   ├── payment/          # IMPLEMENTED: manual deposit/withdraw requests (admin-reviewed)
│   └── admin/            # IMPLEMENTED: read-only stats/users/transactions (adminGuard)
├── common/
│   ├── middleware/       # auth guard, role guard, error handler, zod validation
│   ├── utils/            # requireUserId, AppError, money helpers, pagination
│   └── provably-fair/    # IMPLEMENTED: seed generation, HMAC derivation
└── index.ts              # Express bootstrap (helmet, cors, json, /health)
```

Each module owns its routes, validation, and queries; modules talk to each other through service
functions, never by writing another module's tables directly (e.g. only `wallet/` inserts into
`transactions`).

`backend/migrations/` holds sequential SQL files applied in filename order:
[`001_initial_schema.sql`](../backend/migrations/001_initial_schema.sql) creates `users`,
`transactions`, `game_rounds`, and the `account_balances` view,
[`002_payment_requests.sql`](../backend/migrations/002_payment_requests.sql) adds the manual
payment queue, and [`003_spin_wheel.sql`](../backend/migrations/003_spin_wheel.sql) adds
`game_rounds.multiplier` plus the `'spin'` bet type;
[`004_slots.sql`](../backend/migrations/004_slots.sql) allows the `'slots'` bet type;
[`005_slots_3x3.sql`](../backend/migrations/005_slots_3x3.sql) widens `result` to 64 chars for the
9-reel grid, [`006_dice.sql`](../backend/migrations/006_dice.sql) allows the `'dice'` bet type, and
[`007_aviator.sql`](../backend/migrations/007_aviator.sql) adds the round lifecycle columns
(`crash_point`, `started_at`, `settled_at`, `status`) plus the `'aviator'` bet type, and
[`008_mines.sql`](../backend/migrations/008_mines.sql) creates the `mines_games` board table, and
[`009_plinko.sql`](../backend/migrations/009_plinko.sql) allows the `'plinko'` bet type, and
[`010_blackjack.sql`](../backend/migrations/010_blackjack.sql) creates the `blackjack_games` table, and
[`011_keno.sql`](../backend/migrations/011_keno.sql) allows the `'keno'` bet type and widens
`game_rounds.bet_value` to 64 chars so a round can store all ten picks (`result` already holds the 20
drawn numbers), and [`012_baccarat.sql`](../backend/migrations/012_baccarat.sql) allows the `'baccarat'`
bet type (`bet_value` keeps the side, `result` the winner and both hands), and
[`013_dragontiger.sql`](../backend/migrations/013_dragontiger.sql) allows the `'dragontiger'` bet type
(`bet_value` the side, `result` the winner and both cards), and
[`014_teenpatti.sql`](../backend/migrations/014_teenpatti.sql) allows `'teenpatti'` (`bet_value` unused,
`result` the winner, both categories and both hands), and
[`015_cascade.sql`](../backend/migrations/015_cascade.sql) allows `'cascade'` (`bet_value` unused,
`result` = `<cascades>c|<deepest multiplier>x|<total win>x`).

## 6. Configuration & runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | API port. |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/casino` | PostgreSQL connection string. |
| `JWT_SECRET` | `change-me` | JWT signing key — must be replaced outside local dev. |

Under Docker Compose the backend reaches PostgreSQL at `postgres:5432` on the Compose network; when
running `npm run dev` locally it uses `localhost:5432`. Real secrets belong in the environment, never
in git (`backend/.env` is gitignored; only `.env.example` is committed).

## 7. Client status

- **Web (`web/`)** — implemented: Axios client with JWT interceptor and 401 handling, `AuthContext`,
  React Router with a `ProtectedRoute`, and Login / Register / **Lobby** / **Spin to Win** /
  **Lucky Slots** pages. The lobby is the landing screen: full-height left sidebar (brand + Home /
  Slots / Live Casino / Sports / Promotions with client-side filtering), sticky top bar (avatar,
  phone, gold balance pill, deposit/withdraw, logout), **20 game tiles** (15 slots + 5 live, gradient
  art + emoji, the wheel and slots playable), floating WhatsApp / Telegram / support buttons, a
  mobile bottom nav, and a **cashier modal** for deposit/withdraw requests. The wheel page draws its
  20 segments with a `conic-gradient` built from `/game/roulette/segments`, spins to the winning
  slice with a single decelerating transform, and shows a win/loss overlay with the multiplier.
  The slots page renders a 3×3 cabinet: nine reels roll, stop column by column, then the paying rows
  glow along their payline (`/game/slots/play`), with the paytable in dollars for the current bet.
  The blackjack page is a green-felt table: cards slide in from the shoe, the hole card is a
  patterned back until the hand settles, and HIT / STAND replace DEAL mid-hand.
  The plinko page draws the peg pyramid on a canvas and replays the server's L/R route with
  `requestAnimationFrame`, glowing the winning slot.
  The mines page is a 5×5 board of flipping tiles (controls on the left, board on the right) with a
  live cash-out amount and a resume call on mount.
  The keno page is an 8×10 board of 80 cells with the controls on the right: pick a bet, pick how many
  numbers (1–10), tap cells to select, then DRAW. The draw replays one ball every 55 ms — matched picks
  turn green, missed picks red, the rest of the 20 drawn numbers gold — and the panel prints the live
  ladder for the chosen spot count, highlighting the row that paid.
  The baccarat page is green felt: PLAYER left, BANKER right, cards dealt one at a time from the shoe
  with a slide-in, running totals as they land, and the winning seat glowing once the hand settles. The
  panel carries bet chips, the three odds, and BET PLAYER / BET TIE / BET BANKER.
  The dragon tiger page is the same table language at one card: DRAGON left, TIGER right, a gold VS
  medallion between them, cards sliding in from the shoe one after the other, and the winning seat
  (or both, dimmed, on a tie) glowing.
  The teen patti page is teal-and-crimson felt with three cards a side dealt alternately, each seat
  printing its own hand type (Trail … High Card) as soon as it is complete, and the winner's seat glowing.
  The showdown page is the tumble cabinet: a gold multiplier ladder above a 5×4 grid, symbols falling in
  column by column, winning clusters glowing then popping out, survivors dropping back with new symbols
  falling in — all driven by the server's step list, with the running total in the side panel.
- **Sound (`web/src/utils/sound.ts`)** — all effects are synthesised with the Web Audio API (no audio
  files): `playSound('click' | 'spin' | 'win' | 'lose' | 'crash')`, a decelerating `startSpin(ms)`
  tick loop, and a rising `startFlightTone()` / `updateFlightTone()` / `stopFlightTone()` engine hum for
  Aviator. The `AudioContext` is created **lazily inside a gesture** (a one-shot `pointerdown`/`keydown`
  listener primes it) so autoplay policies never block it. `<SoundToggle />` in every top bar flips the
  `casino.sound.muted` preference in `localStorage` and notifies subscribers, so all pages stay in sync.
  The dice page shows a 1–100 track with the living zones, flickers the number for ~1 s, then settles
  on the server roll (`/game/dice/play`) with ROLL HIGH / ROLL LOW buttons. The aviator page paints
  the flight on a canvas (`requestAnimationFrame`, `e^(t/τ)`), sizes its timer from the server's
  `durationMs`, and flips the single action button from PLACE BET to CASH OUT mid-flight.
- **Admin (`admin/`)** — implemented: admin-only login (rejects non-admin roles), `admin_token`
  storage (separate from the player app), protected route, stat cards, a **Pending Payments** queue
  with Approve/Reject, plus read-only users and transactions tables.
- **Mobile (`mobile/`)** — implemented: `dio` API client (JWT interceptor + 401 hook), `provider`
  `AuthProvider` with `shared_preferences` persistence, login / register screens, a Home lobby (game
  grid + 3-tab `NavigationBar` + deposit/withdraw dialogs) and a playable roulette screen. `AuthGate`
  opens the lobby when a token is stored, otherwise login. Talks to `http://10.0.2.2:3000/api`.

Not built yet: payment and admin endpoints, refresh tokens / password reset, rate limiting, RLS,
KYC/AML flows, and the provably-fair reveal endpoint.

Remaining work is tracked in [DB_SCHEMA.md](./DB_SCHEMA.md#7-deliberately-out-of-scope-for-the-mvp)
and [getting-started.md](./getting-started.md).



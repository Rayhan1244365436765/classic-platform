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
- **Money is server-computed.** Clients submit *intents* (e.g. "bet 10 on red"), never amounts to
  credit, and never a resulting balance.

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
| `POST` | `/api/game/roulette/play` | Bearer | `201 { resultNumber, resultColor, won, payout, serverSeedHash, … }` |
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

Roulette request body: `{ "betAmount": 10, "betType": "red" }` or
`{ "betAmount": 10, "betType": "number", "betValue": "7" }`. Errors: `400 VALIDATION_ERROR`,
`400 INVALID_BET_AMOUNT`, `400 INVALID_BET_TYPE`, `400 INVALID_BET_VALUE`,
`400 INSUFFICIENT_FUNDS`.

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

### A roulette round in ledger terms

A 10.00 bet on red that wins pays 2× (stake back + 10.00 profit). After settling, `transactions`
holds two rows linked by the same `reference_id` (the round id):

| type | amount | reference_id |
| --- | --- | --- |
| `bet` | `-10.00` | `round-id` |
| `win` | `+20.00` | `round-id` |

A losing round writes only the `bet` row. The balance is recomputed by summation — nothing is
mutated in place.

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
`game_rounds_server_seed_hash_check` constraint) and `generateProvablyFairResult()`.

**Fairness caveat for the MVP:** the house edge comes from the payout table, not from biasing the
RNG. Implemented multipliers: `number` 36×, `red`/`black` 2×, `green` 14×. Pocket colours follow the
product spec (`1–10` and `19–28` red, `11–18` and `29–36` black, `0` green) — see `getRouletteColor`
in `backend/src/modules/game/roulette/roulette.service.ts` if that mapping is ever revised.

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
│   ├── game/roulette/    # IMPLEMENTED: round lifecycle, bet validation, payout table
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
`transactions`, `game_rounds`, and the `account_balances` view.

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
  React Router with a `ProtectedRoute`, Login / Register / Dashboard / **Roulette** pages, and a
  **cashier** (deposit / withdraw request form) on the dashboard.
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



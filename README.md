# Casino Platform

A full-stack online casino MVP in a single monorepo: a TypeScript REST API, a player web app, an
operator (admin) dashboard and a Flutter Android app.

The MVP ships with JWT authentication, an **append-only wallet ledger**, a **provably-fair "Spin to
Win" lucky wheel** (20 segments, 70% RTP), and **manual deposits/withdrawals** reviewed by an
operator — the bridge until a real payment gateway (bKash, Stripe, …) is integrated.

> **Status:** feature-complete MVP. `backend`, `web`, `admin` build and lint cleanly; the Flutter app
> is written but was never compiled in the environment where the repo was produced (no Flutter SDK) —
> run `flutter analyze` once locally.

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Step-by-Step Setup Guide](#step-by-step-setup-guide)
- [Creating the First Admin User](#creating-the-first-admin-user)
- [Folder Structure](#folder-structure)
- [API Reference](#api-reference)
- [Scripts](#scripts)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

## Project Overview

A player registers with a phone number and password, receives a wallet, tops it up through a manual
deposit request, spins the multiplier wheel, and cashes out through a withdrawal request. Every money
movement is a row in a ledger — balances are never stored or mutated directly:

```
balance(user) = Σ transactions.amount  WHERE status = 'completed'
```

| Capability | Where | Notes |
| --- | --- | --- |
| Phone + password auth | `backend/src/modules/auth` | bcrypt (cost 10) + JWT (`{ id, role }`, 7 days) |
| Wallet ledger | `backend/src/modules/wallet` | `deposit`, `withdraw`, balance = sum of ledger rows |
| Spin to Win wheel | `backend/src/modules/game/roulette` | 20 segments (0×–10×), atomic stake → payout → round row |
| Lucky Slots | `backend/src/modules/game/slots` | 3×3 grid, 3 paylines at 8.4× each, atomic stake → payout → round row |
| Dice (High/Low) | `backend/src/modules/game/dice` | roll 1–100, 1.95× on a win, 50 loses |
| Mines | `backend/src/modules/game/mines` | 5×5 board, hidden layout, 3% edge, own `mines_games` table |
| Plinko | `backend/src/modules/game/plinko` | 8-row peg board, 9 slots, 97% RTP (3% edge) |
| Keno | `backend/src/modules/game/keno` | 20 of 80 drawn, 1–10 picks, per-count ladders at ~97% RTP (3% edge) |
| Baccarat | `backend/src/modules/game/baccarat` | single deck, full third-card tableau, tie pushes Player/Banker |
| Dragon Tiger | `backend/src/modules/game/dragontiger` | 8-deck shoe, one card each, tie loses the side bets |
| Teen Patti | `backend/src/modules/game/teenpatti` | 3 cards each, full 6-category ranking, 5% rake on wins |
| Showdown (cascade) | `backend/src/modules/game/cascade` | 5×4 cluster-pays slot, Wild West emoji set, tumble ×1→×16, 95.72% RTP |
| Classic Roulette | `backend/src/modules/game/classic_roulette` | 37 pockets (0–36), 0 green, straight 36×, outside 2×, 97.30% RTP on every bet |
| Fruit Bonanza | `backend/src/modules/game/fruit_bonanza` | 3×3 fruit reels, 5 paylines, 3-of-a-kind 4× / 2-of-a-kind 0.2×, 97.22% RTP |
| 3D Dice | `backend/src/modules/game/dice3d` | three dice, high/low 2× (a triple loses), totals 7.8×–210×, 97.22% RTP |
| Boxing King | `backend/src/modules/game/boxing_king` | 3×3 cluster pays, 3-4 / 5-6 / 7+ → 2× / 8.5× / 30×, 97.42% RTP |
| Blackjack | `backend/src/modules/game/blackjack` | single-deck 21, hit/stand, own `blackjack_games` table |
| Aviator | `backend/src/modules/game/aviator` | crash game: hidden crash point, server-timed cash-out |
| Provably fair RNG | `backend/src/common/provably-fair` | server-seed commit, HMAC-SHA256 index in `[0, 20)` |
| Manual payments | `backend/src/modules/payment` | deposit/withdraw requests awaiting approval |
| Admin reporting & approval | `backend/src/modules/admin` | stats, users, transactions, payment queue |
| Player web app | `web/` | login, register, lobby, cashier, wheel + slots + dice + aviator |
| Admin dashboard | `admin/` | admin-only login, stats cards, review tables/queue |
| Android app | `mobile/` | login, register, lobby, roulette, cashier dialogs |

## Architecture

Four deployable pieces talk to one REST API; only the API touches PostgreSQL.

```
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│  web  (React SPA)  │   │ admin (React SPA)  │   │ mobile (Flutter)   │
│  :5173             │   │ :5174              │   │ Android emulator   │
└─────────┬──────────┘   └─────────┬──────────┘   └─────────┬──────────┘
          │  HTTPS/JSON + Bearer <JWT>                       │
          └───────────────┬──────────────────────────────────┘
                          ▼
              ┌───────────────────────────┐        ┌──────────────────┐
              │  backend (Express + TS)   │───────▶│  PostgreSQL 16   │
              │  :3000                    │  pg    │  :5432           │
              └───────────────────────────┘        └──────────────────┘
```

**Backend** — Express 5 + TypeScript. Stateless: identity and role come from the JWT, never from the
request body. Feature modules (`auth`, `wallet`, `game/roulette`, `payment`, `admin`) own their
routes, validation and queries; only the wallet module writes to `transactions`. Every money movement
runs inside one database transaction (`config/db.ts → withTransaction`) with row locks where needed.
Errors always use `{ "error": { "code", "message" } }`.

**Web player app** — React 19 + Vite. Axios client attaches the `token` from `localStorage`; a 401
clears the session and redirects to `/login`. `AuthContext` holds the session, `ProtectedRoute`
guards `/` and `/roulette`.

**Admin dashboard** — React 19 + Vite, separate app with its own storage key (`admin_token`) so an
operator session and a player session can coexist in one browser. Login rejects non-admin accounts;
every admin route on the server sits behind `authGuard` + `adminGuard` (403 for players).

**Mobile app** — Flutter (Android, package `com.casinoplatform.casino_mobile`). `dio` client with a
JWT interceptor, `provider` for state, `shared_preferences` for the session, and an `AuthGate` that
shows the lobby when a token is stored. Points at `http://10.0.2.2:3000/api` (emulator → host
localhost).

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| **Node.js** | 20 LTS or newer (tested on 24) | backend, web, admin |
| **npm** | 10+ | dependency install |
| **Docker Desktop** | any recent version | PostgreSQL via `docker compose` |
| *(or)* **PostgreSQL** | 16 (13+) | if not using Docker |
| **psql** | ships with PostgreSQL | applying migrations |
| **Flutter SDK** | 3.22+ / Dart 3.4+ | mobile app |
| **Android Studio** + emulator | any recent version | running the mobile app |
| **Git** | 2.40+ | version control |

No global CLI tooling is required — everything runs through `npm` scripts and `flutter`.

## Step-by-Step Setup Guide

Clone/download the repo, then run everything from the repository root.

### 1. Start the database

```bash
docker compose up -d
```

This starts **PostgreSQL 16** on `localhost:5432` (user `postgres`, password `postgres`, database
`casino`) with data persisted in the `pgdata` volume, plus the backend container on `:3000`.

Check it is up:

```bash
docker compose ps
curl http://localhost:3000/health      # {"status":"ok"}
```

> Prefer running the API outside Docker? Start only the database:
> `docker compose up -d postgres` (and skip the `backend` service).

### 2. Apply the migrations

Migrations are plain SQL and must be applied **in order** (they are idempotent):

```bash
psql "postgresql://postgres:postgres@localhost:5432/casino" -f backend/migrations/001_initial_schema.sql
psql "postgresql://postgres:postgres@localhost:5432/casino" -f backend/migrations/002_payment_requests.sql
```

* `001_initial_schema.sql` — `users`, `transactions` (the ledger), `game_rounds`, the
  `account_balances` view, the `set_updated_at` trigger and the `uuid-ossp` extension.
* `002_payment_requests.sql` — `payment_requests` (manual deposits/withdrawals awaiting review).

Verify:

```bash
psql "postgresql://postgres:postgres@localhost:5432/casino" -c "\dt"
```

> If `psql` is unavailable, run the same files from inside the container:
>
> ```bash
> docker compose exec -T postgres psql -U postgres -d casino < backend/migrations/001_initial_schema.sql
> docker compose exec -T postgres psql -U postgres -d casino < backend/migrations/002_payment_requests.sql
> ```

### 3. Start the backend

```bash
cd backend
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm install
npm run dev                   # nodemon + ts-node on http://localhost:3000
```

`.env` values (the defaults work with the Docker database):

```ini
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/casino
JWT_SECRET=change-me
```

```bash
curl http://localhost:3000/health      # {"status":"ok"}
```

> If you started the `backend` service with Docker Compose, this step is already done — the container
> runs the API on `:3000` against the `postgres` service.

### 4. Start the web app (players)

```bash
cd web
npm install
npm run dev                   # http://localhost:5173
```

The API URL defaults to `http://localhost:3000/api`; override it with a `web/.env` file:

```ini
VITE_API_URL=http://localhost:3000/api
```

### 5. Start the admin app (operators)

```bash
cd admin
npm install
npm run dev                   # http://localhost:5174
```

The same `VITE_API_URL` override applies (`admin/.env`). The admin app stores its JWT under
`admin_token`, so it will not clash with a player session in the same browser.

### 6. Start the mobile app (Android)

```bash
cd mobile
flutter pub get
flutter emulators --launch <emulator_id>    # or connect a device
flutter run
```

The app calls `http://10.0.2.2:3000/api` — `10.0.2.2` is how the Android emulator reaches your
machine's `localhost`. On a physical device pass your LAN IP:

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.1.5:3000/api
```

> **First run only:** `mobile/` was authored by hand rather than generated, so its Gradle wrapper is
> missing. From inside `mobile/` run
> `flutter create . --org com.casinoplatform --project-name casino_mobile` once, then
> `flutter pub get && flutter run`. Your `lib/` code is preserved.

## Creating the First Admin User

There is no seeded admin — an admin is simply a normal account whose `role` is `admin`. Create one,
then promote it.

**1. Register a normal account** (any of the three clients, or curl):

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"+8801700000001","password":"admin123"}'
```

**2. Promote it to admin** with SQL:

```bash
psql "postgresql://postgres:postgres@localhost:5432/casino" -c \
  "UPDATE users SET role = 'admin' WHERE phone = '+8801700000001';"
```

Or from inside the container:

```bash
docker compose exec -T postgres psql -U postgres -d casino -c \
  "UPDATE users SET role = 'admin' WHERE phone = '+8801700000001';"
```

**3. Verify and sign in:**

```bash
psql "postgresql://postgres:postgres@localhost:5432/casino" -c \
  "SELECT phone, role FROM users ORDER BY created_at;"
```

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+8801700000001","password":"admin123"}'
# → { "token": "...", "user": { "id": "...", "phone": "...", "role": "admin" } }
```

Open `http://localhost:5174` and sign in — the **Pending Payments** queue, users and transactions
tables are now available.

> **Important:** the role is baked into the JWT. If you promote an account that is already signed in,
> that session keeps `role: 'user'` until it signs in again (or the 7-day token expires).

## Folder Structure

```
casino-platform/
├── backend/                  # Express 5 + TypeScript REST API (:3000)
│   ├── migrations/           # 001_initial_schema.sql, 002_payment_requests.sql
│   ├── src/
│   │   ├── config/           # db.ts (pool, query, withTransaction), env.ts
│   │   ├── modules/          # auth, wallet, game/roulette, game/slots, game/dice, game/aviator, payment, admin
│   │   ├── common/           # middleware (authGuard, adminGuard, errorHandler),
│   │   │                     # utils (AppError, requireUserId), provably-fair (HMAC-SHA256)
│   │   └── index.ts          # Express app: /health + /api/*
│   ├── Dockerfile
│   └── .env.example
├── web/                      # React 19 + Vite player app (:5173)
│   └── src/                  # api/, context/, components/ (Modal, GameResultOverlay, Icons, SoundToggle,
│                             #   LivePlayerBadge, ProtectedRoute), utils/, pages/ (Login, Lobby, …)
├── admin/                    # React 19 + Vite operator dashboard (:5174)
│   └── src/                  # api/, components/, pages/ (Login, Dashboard)
├── mobile/                   # Flutter Android app (com.casinoplatform.casino_mobile)
│   ├── lib/
│   │   ├── core/             # api/ (dio client, token storage), theme/ (AppColors, AppTheme)
│   │   └── features/         # auth/, wallet/ (lobby), roulette/
│   └── pubspec.yaml
├── docs/                     # ARCHITECTURE.md, DB_SCHEMA.md, DEPLOYMENT.md, getting-started.md
├── docker-compose.yml        # PostgreSQL 16 + backend
├── .gitignore
└── README.md
```

## API Reference

All responses are JSON; errors are always `{ "error": { "code", "message" } }`.

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | – | liveness probe |
| `POST` | `/api/auth/register` | – | create an account |
| `POST` | `/api/auth/login` | – | sign in, returns a JWT |
| `GET` | `/api/wallet/balance` | Bearer | ledger-derived balance |
| `POST` | `/api/wallet/deposit` | Bearer | direct credit (dev convenience) |
| `POST` | `/api/wallet/withdraw` | Bearer | direct debit (dev convenience) |
| `GET` | `/api/payment/mine` | Bearer | own payment requests |
| `POST` | `/api/payment/deposit` | Bearer | file a deposit request |
| `POST` | `/api/payment/withdraw` | Bearer | file a withdrawal request (debited immediately) |
| `GET` | `/api/game/roulette/segments` | Bearer | wheel layout, per-multiplier odds, RTP |
| `POST` | `/api/game/roulette/play` | Bearer | spin the wheel (`{ betAmount }`) |
| `GET` | `/api/game/slots/config` | Bearer | slot symbols + paytable |
| `POST` | `/api/game/slots/play` | Bearer | spin the reels (`{ betAmount }`) |
| `GET` | `/api/game/dice/config` | Bearer | dice payout + winning ranges |
| `POST` | `/api/game/dice/play` | Bearer | roll high/low (`{ betAmount, prediction }`) |
| `POST` | `/api/game/aviator/start` | Bearer | open a crash round (`{ betAmount }`) |
| `POST` | `/api/game/aviator/cashout` | Bearer | cash out (`{ roundId, multiplier }`) |
| `POST` | `/api/game/aviator/crash` | Bearer | forfeit a flying round (`{ roundId }`) |
| `GET` | `/api/game/mines/current` | Bearer | the board to resume, if any |
| `GET` | `/api/game/mines/table?mines=3` | Bearer | pay table (multiplier per gem) |
| `POST` | `/api/game/mines/start` | Bearer | open a board (`{ betAmount, minesCount }`) |
| `POST` | `/api/game/mines/reveal` | Bearer | open a tile (`{ gameId, tileIndex }`) |
| `POST` | `/api/game/mines/cashout` | Bearer | cash out (`{ gameId }`) |
| `GET` | `/api/game/plinko/config` | Bearer | board size + pay table |
| `POST` | `/api/game/plinko/play` | Bearer | drop a ball (`{ betAmount, rows }`) |
| `GET` | `/api/game/keno/config` | Bearer | board size + all 10 pay ladders |
| `POST` | `/api/game/keno/play` | Bearer | draw 20 of 80 (`{ betAmount, selectedNumbers }`) |
| `GET` | `/api/game/baccarat/config` | Bearer | payouts, rules + exact odds |
| `POST` | `/api/game/baccarat/play` | Bearer | deal a hand (`{ betAmount, betOn }`) |
| `GET` | `/api/game/dragontiger/config` | Bearer | shoe size, payouts + exact odds |
| `POST` | `/api/game/dragontiger/play` | Bearer | one card each (`{ betAmount, betOn }`) |
| `GET` | `/api/game/teenpatti/config` | Bearer | ranking, payouts + exact odds |
| `POST` | `/api/game/teenpatti/play` | Bearer | 3 cards each (`{ betAmount }`) |
| `GET` | `/api/game/cascade/config` | Bearer | symbols, multipliers + pay table |
| `POST` | `/api/game/cascade/play` | Bearer | spin the tumble grid (`{ betAmount }`) |
| `GET` | `/api/game/classic_roulette/config` | Bearer | pockets, colours, wheel order, payouts + exact odds |
| `POST` | `/api/game/classic_roulette/play` | Bearer | one spin (`{ betAmount, betType, betValue? }`) |
| `GET` | `/api/game/fruit_bonanza/config` | Bearer | symbols, paylines, paytable + exact odds |
| `POST` | `/api/game/fruit_bonanza/play` | Bearer | spin the 3×3 reels (`{ betAmount }`) |
| `GET` | `/api/game/dice3d/config` | Bearer | paytable, combos + exact odds |
| `POST` | `/api/game/dice3d/play` | Bearer | roll three dice (`{ betAmount, betType }`) |
| `GET` | `/api/game/boxing_king/config` | Bearer | symbols, cluster paytable + measured odds |
| `POST` | `/api/game/boxing_king/play` | Bearer | spin the 3×3 board (`{ betAmount }`) |
| `GET` | `/api/game/blackjack/current` | Bearer | the hand to resume, if any |
| `POST` | `/api/game/blackjack/start` | Bearer | deal a hand (`{ betAmount }`) |
| `POST` | `/api/game/blackjack/hit` | Bearer | take a card (`{ gameId }`) |
| `POST` | `/api/game/blackjack/stand` | Bearer | stand and let the dealer play (`{ gameId }`) |
| `GET` | `/api/admin/stats` | Bearer + admin | users / wagered / payouts |
| `GET` | `/api/admin/users` | Bearer + admin | users with balances |
| `GET` | `/api/admin/transactions` | Bearer + admin | latest 100 ledger rows |
| `GET` | `/api/admin/payments` | Bearer + admin | pending review queue |
| `POST` | `/api/admin/payments/:id/approve` | Bearer + admin | approve (deposit → credit) |
| `POST` | `/api/admin/payments/:id/reject` | Bearer + admin | reject (withdraw → refund) |

## Scripts

| Where | Command | Does |
| --- | --- | --- |
| `backend` | `npm run dev` | ts-node + nodemon (auto-reload) |
| `backend` | `npm run build` | `tsc` → `dist/` |
| `backend` | `npm start` | run the compiled API |
| `web` / `admin` | `npm run dev` | Vite dev server |
| `web` / `admin` | `npm run build` | type-check + production bundle |
| `web` / `admin` | `npm run lint` | ESLint |
| `mobile` | `flutter run` | run on device/emulator |
| `mobile` | `flutter analyze` / `flutter test` | static analysis / widget tests |

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL not running — `docker compose up -d`, then re-apply migrations. |
| `500 INTERNAL_ERROR` on every API call | Migrations not applied, or `DATABASE_URL` is wrong. Check the backend logs. |
| `relation "users" does not exist` | Apply `001_initial_schema.sql` first. |
| `relation "payment_requests" does not exist` | Apply `002_payment_requests.sql`. |
| `INVALID_CREDENTIALS` on the admin app | The account's `role` is not `admin` (see above). |
| `FORBIDDEN` from `/api/admin/*` | The JWT carries `role: 'user'` — sign in with an admin account. |
| CORS errors in the browser | Point `VITE_API_URL` at the API origin (`http://localhost:3000/api`). |
| Flutter: `CLEARTEXT communication not permitted` | Keep `android:usesCleartextTraffic="true"` for local dev (already set). |
| Flutter: cannot reach the API | Use `10.0.2.2` on the emulator, your LAN IP on a physical device. |

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design: stack, single API, wallet ledger, provably-fair RNG |
| [docs/DB_SCHEMA.md](docs/DB_SCHEMA.md) | Every table, column and constraint, with the SQL |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment roadmap (Render/Railway/DigitalOcean + Vercel/Netlify) |
| [docs/getting-started.md](docs/getting-started.md) | Condensed local setup per app |
| [mobile/README.md](mobile/README.md) | Flutter app specifics |

## Roadmap

- Replace manual `payment_requests` with a real gateway (bKash / Stripe) and webhooks.
- Provably-fair reveal endpoint + storing `client_seed`/`nonce` per round so players can verify spins.
- Bet history UI, promotions, and the remaining game tiles on mobile.
- Rate limiting, refresh tokens and row-level security before handling real money.

## License

Released for educational/demo purposes. Real-money gambling is regulated — obtain the appropriate
licences before operating this commercially.




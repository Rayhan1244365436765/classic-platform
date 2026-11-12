# Casino Platform

A full-stack online casino MVP in a single monorepo: a TypeScript REST API, a player web app, an
operator (admin) dashboard and a Flutter Android app.

The MVP ships with JWT authentication, an **append-only wallet ledger**, a **provably-fair roulette**
implementation, and **manual deposits/withdrawals** reviewed by an operator — the bridge until a real
payment gateway (bKash, Stripe, …) is integrated.

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
deposit request, plays European roulette, and cashes out through a withdrawal request. Every money
movement is a row in a ledger — balances are never stored or mutated directly:

```
balance(user) = Σ transactions.amount  WHERE status = 'completed'
```

| Capability | Where | Notes |
| --- | --- | --- |
| Phone + password auth | `backend/src/modules/auth` | bcrypt (cost 10) + JWT (`{ id, role }`, 7 days) |
| Wallet ledger | `backend/src/modules/wallet` | `deposit`, `withdraw`, balance = sum of ledger rows |
| Roulette | `backend/src/modules/game/roulette` | atomic bet → payout → round row, HMAC-SHA256 |
| Provably fair RNG | `backend/src/common/provably-fair` | server-seed commit, deterministic result 0–36 |
| Manual payments | `backend/src/modules/payment` | deposit/withdraw requests awaiting approval |
| Admin reporting & approval | `backend/src/modules/admin` | stats, users, transactions, payment queue |
| Player web app | `web/` | login, register, dashboard, cashier, playable roulette |
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
│   │   ├── modules/          # auth, wallet, game/roulette, payment, admin
│   │   ├── common/           # middleware (authGuard, adminGuard, errorHandler),
│   │   │                     # utils (AppError, requireUserId), provably-fair (HMAC-SHA256)
│   │   └── index.ts          # Express app: /health + /api/*
│   ├── Dockerfile
│   └── .env.example
├── web/                      # React 19 + Vite player app (:5173)
│   └── src/                  # api/, context/, components/, pages/
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
| `POST` | `/api/game/roulette/play` | Bearer | play a round |
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




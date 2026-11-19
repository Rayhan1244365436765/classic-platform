# PROJECT_STATUS — Casino Platform

> Shared understanding document, generated during a full codebase reconnaissance.
> Author: Cline (agent) + Rayhan (owner) · Date: 2026-11-19
> Scope: analysis only. No existing code was modified. This file is the only new artifact.

---

## 1. Project Overview

A **full-stack online casino platform** organized as a single monorepo with one REST API and
several clients:

- **Backend** — Node.js + Express 5 + TypeScript REST API. Single source of truth for all money.
- **Web** — React 19 + Vite player app (the "main" product).
- **Admin** — React 19 + Vite operator dashboard (reporting + payment review/approval).
- **Mobile** — Flutter (Android) player app.
- **Desktop** — *Electron placeholder only* (no source code).

The product loop is: a player registers with **phone + password**, gets a wallet, files a
**manual deposit request** (reviewed by an operator), plays **games**, and files a
**withdrawal request**. Every movement of money is an append-only row in a
`transactions` ledger — balances are never stored, only derived:

```
balance(user) = Σ transactions.amount WHERE status = 'completed'
```

The platform ships **17 provably-fair games** (slots, dice, table games, crash/aviator, mines,
plinko, keno, etc.). The repo README/ARCHITECTURE docs describe it as "**feature-complete MVP**" —
accurate for the *web + backend + admin* slice, but the project is best understood as
**~70–75% of a production-ready product**, with clear gaps in sections 5 and 6 (payment gateway,
provably-fair *verification*, mobile coverage, desktop, security hardening, tests).

---

## 2. Tech Stack Detected

| Layer | Technology | Notes |
| --- | --- | --- |
| Language (BE) | TypeScript 6 | `strict`, `nodenext` modules, ESM (`"type": "module"`) |
| API framework | Express 5 | REST, JSON |
| Validation | zod 4 | request schemas (`auth.schema.ts`) |
| Auth | **JWT** (jsonwebtoken, 7-day expiry) + **bcrypt** (cost 10) | no refresh tokens, no sessions table |
| Database | **PostgreSQL 16** (via `pg`) | append-only ledger, `NUMERIC(18,2)` money |
| Web/Admin UI | React 19 + Vite 8 + TypeScript | `axios`, `react-router-dom` 7 |
| State (web) | React context (`AuthContext`) + localStorage | no Redux/Zustand |
| Mobile | Flutter (Dart SDK ^3.4) | `dio`, `provider`, `shared_preferences` |
| Desktop | Electron (declared, no code) | dev-only stub |
| RNG / fairness | custom provably-fair (HMAC/commitment) | seeded per round; verification incomplete (see §5) |
| Infra | Docker Compose (dev + prod), nginx (TLS), certbot | prod stack in `docker-compose.prod.yml` |

**Architecture:** monolithic single-API / multi-client (client-server). One stateless REST API at
`:3000`; web/admin/mobile are thin clients that only ever call the API (never Postgres directly).
Production is containerised behind nginx which serves the React bundles and proxies `/api`.

## 3. Folder Structure

```
casino-platform/
├── backend/               TypeScript Express API (the core)
│   ├── migrations/        001…017, 019, 020, 021  (NOTE: 018 is missing — see Risks)
│   ├── scripts/           smoke-test + RTP-verifier scripts (`.ps1` / `.mjs` / `.cjs`)
│   └── src/
│       ├── config/        db.ts (pool + withTransaction), env.ts
│       ├── common/        middleware (authGuard, adminGuard, errorHandler),
│       │                  provably-fair/, utils/ (AppError, requireUser)
│       └── modules/
│           ├── auth/      register, login, JWT
│           ├── wallet/    ledger (balance, deposit, withdraw)
│           ├── payment/   manual deposit/withdraw requests
│           ├── admin/     stats, users, transactions, payment approve/reject
│           └── game/      17 game modules (aviator…teenpatti)
├── web/                   React player SPA  (16 game pages + Lobby/Login/Register)
├── admin/                 React operator SPA (Login, Dashboard)
├── mobile/                Flutter Android app (auth, wallet/roulette only)
├── desktop/               Electron stub (package.json only)
├── docs/                  ARCHITECTURE, DB_SCHEMA, DEPLOYMENT, getting-started, (stale) README
├── nginx/                 default.conf + Dockerfile (TLS reverse proxy)
├── docker-compose.yml     dev stack (postgres + backend)
├── docker-compose.prod.yml production stack (postgres + migrate + backend + nginx + certbot)
├── .env.production        tracked secrets TEMPLATE (placeholders only)
└── README.md              canonical, detailed project readme
```

## 4. Completed Features (with file references)

### 4.1 Core platform (backend)
| Feature | Backend files | Notes |
| --- | --- | --- |
| Phone+password registration | `backend/src/modules/auth/auth.service.ts`, `auth.controller.ts`, `auth.routes.ts`, `auth.schema.ts` | bcrypt(10), unique-phone → 409 |
| Login + JWT issue | same module | `{ id, role }` token, 7d expiry |
| JWT auth guard / admin guard | `backend/src/common/middleware/authGuard.ts`, `adminGuard.ts` | `req.user`, role check → 403 |
| Wallet ledger | `backend/src/modules/wallet/wallet.service.ts` | append-only `transactions`; balance = SUM; `withTransaction` + `FOR UPDATE` row lock |
| Manual payments | `backend/src/modules/payment/payment.service.ts` | deposit (credits on approve) / withdraw (debits now, refund on reject); `payment_requests` table |
| Admin reporting + review | `backend/src/modules/admin/admin.service.ts` | stats, users, transactions; approve/reject with row lock (double-approve → 409) |
| Provably-fair RNG primitives | `backend/src/common/provably-fair/index.ts` | server seed, hash, client seed, index/fraction derivation |
| Uniform error envelope | `backend/src/common/middleware/errorHandler.ts` + `utils/AppError.ts` | `{ error: { code, message } }` |

### 4.2 Games — backend (17 modules, all implemented)
Each follows the same `controller.ts / routes.ts / service.ts` pattern with a `GET /config` and
`POST /play` (multi-step games add extra endpoints), atomic settle, and a matching migration +
smoke script.

| Game | Module | Notable |
| --- | --- | --- |
| Spin to Win (wheel) | `game/roulette` | 20 segments, RTP 70% |
| Lucky Slots | `game/slots` | 3×3, 3 paylines, 8.4× |
| Dice | `game/dice` | roll 1–100, 1.95× |
| 3D Dice | `game/dice3d` | 3 dice, high/low + totals |
| Aviator (crash) | `game/aviator` | server-authoritative cash-out |
| Mines | `game/mines` | 5×5 hidden board, own table |
| Plinko | `game/plinko` | 8-row peg board, 97% RTP |
| Keno | `game/keno` | 20/80, 1–10 picks |
| Blackjack | `game/blackjack` | hit/stand, own table |
| Baccarat | `game/baccarat` | full third-card tableau |
| Dragon Tiger | `game/dragontiger` | 8-deck shoe |
| Teen Patti | `game/teenpatti` | 6-category ranking, 5% rake |
| Showdown (cascade) | `game/cascade` | 5×4 cluster pays, tumble |
| Classic Roulette | `game/classic_roulette` | 37 pockets |
| Fruit Bonanza | `game/fruit_bonanza` | 3×3 fruit reels |
| Boxing King | `game/boxing_king` | 3×3 cluster pays |
| Fortune Gems | `game/fortune_gems` | 4×3 cluster pays (see §5 — no web page) |

### 4.3 Web player app — `web/`
- Auth flow: `src/pages/Login.tsx`, `Register.tsx`; session `src/context/AuthContext.tsx` + `auth-context.ts`.
- Lobby/cashier with deposit & withdraw: `src/pages/Lobby.tsx` (uses the manual `payment/*` flow).
- Route guard: `src/components/ProtectedRoute.tsx`.
- 16 of 17 games have a page + route in `src/App.tsx` (see §5 for the missing one):
  Aviator, Baccarat, Blackjack, BoxingKing, Cascade, ClassicRoulette, Dice, Dice3D, DragonTiger,
  FruitBonanza, Keno, Mines, Plinko, Roulette, Slots, TeenPatti.
- Shared UI/utilities: `src/components/*` (GameShell, Modal, WinModal, Icons, SoundToggle,
  LivePlayerBadge), `src/utils/sound.ts`, `src/utils/livePlayers.ts`.
- Typed API layer: `src/api/client.ts`, `src/api/types.ts`.

### 4.4 Admin app — `admin/`
- Admin login: `src/pages/Login.tsx`; guard: `src/components/ProtectedRoute.tsx`.
- Dashboard: `src/pages/Dashboard.tsx` — stats cards, users table, transactions table, and a
  **payment review queue** with Approve/Reject pulling from `/api/admin/*`.
- Separate session storage keys from the player app: `src/api/client.ts`.

### 4.5 Mobile (Flutter) — `mobile/`
- Session/auth: `lib/features/auth/` (login, register, `auth_provider.dart`).
- Wallet dashboard (lobby + balance + deposit/withdraw): `lib/features/wallet/dashboard_screen.dart`.
- Roulette game: `lib/features/roulette/roulette_screen.dart`.
- API client with JWT + 401 hook: `lib/core/api/api_client.dart`, `token_storage.dart`.

### 4.6 Data & infrastructure
- Migrations: `backend/migrations/001…021` (users, transactions, game_rounds, payment_requests,
  per-game tables). Schema doc: `docs/DB_SCHEMA.md`.
- Dev compose: `docker-compose.yml`. Prod compose: `docker-compose.prod.yml` (migrate one-shot,
  backend healthcheck, nginx TLS + certbot profile, DB firewalled from host).
- nginx: `nginx/default.conf`, `nginx/Dockerfile`.

## 5. Partially Implemented Features (and what's missing)

| # | Area | Where | What is missing |
| --- | --- | --- | --- |
| 1 | **Provably-fair verification** | `backend/src/common/provably-fair/index.ts`, game services | Server seed *hash* is committed, but `client_seed`/`nonce` are **not stored per round** and there is **no reveal endpoint** (`GET /game/roulette/rounds/:id/reveal`). Players can see the commitment but cannot prove a spin. Explicitly noted as "still missing" in `docs/ARCHITECTURE.md`. |
| 2 | **Fortune Gems game (web)** | `web/src/pages/` (missing `FortuneGems.tsx`), `web/src/App.tsx` | Backend module + migration + `web/src/api/types.ts` are complete, but **no page and no route**. The lobby (`web/src/pages/Lobby.tsx:67`) lists it `active: true` with `path: '/fortune-gems'` → clicking it falls through the catch-all route back to `/`. **Broken "Play now" tile.** |
| 3 | **Mobile app coverage** | `mobile/lib/features/` | Only **auth + wallet/dashboard + roulette** are built. The other 16 games, payment history, and lobby polish are absent. Roadmap: "remaining game tiles on mobile". |
| 4 | **Payment gateway** | `backend/src/modules/payment/` | Manual `payment_requests` only (operator reviews). No bKash/Stripe integration, no webhooks, no provider tables. Repo's stated #1 roadmap item. |
| 5 | **Player history UI** | `web/src/pages/Lobby.tsx` (Profile button shows a toast only) | No bet/history page or transaction history screen. Backend also lacks `GET /wallet/transactions` (only `payment/mine` exists). |
| 6 | **wallet self-credit endpoints** | `backend/src/modules/wallet/wallet.routes.ts`, `wallet.controller.ts` | `/wallet/deposit` & `/wallet/withdraw` directly credit/debit the ledger; smoke scripts use them to fund test users. ✅ **Fixed — dev-only**: they now return 404 when `NODE_ENV=production` unless `ENABLE_DEV_WALLET_ENDPOINTS=true`. |
| 7 | **wallet vs payment overlap** | `wallet.routes.ts` vs `payment.routes.ts` | Two deposit/withdraw code paths (direct ledger vs. reviewed requests). Confusing + duplication risk. |
| 8 | **Desktop app** | `desktop/` | Electron declared in `package.json` but **no source** — only `package.json` + `package-lock.json` + `node_modules`. |
| 9 | **Lobby placeholder tiles** | `web/src/pages/Lobby.tsx:62-72` | "Pinata Wins", "Super Teddy", "Lucky Bingo", "Ganesha Gold", "Caishen Wins", and a duplicate "Dragon Tiger" tile are decorative "Coming Soon" cards (no `path`/`active`). Sports, Promotions, and support buttons are toast stubs. |

## 6. Missing Features (not started)

Absent from code + schema + docs, typical of a production casino platform:

- **Real payment gateway** (bKash/Stripe/Razorpay/etc.) + webhooks + reconciliation.
- **KYC / identity verification** — no tables, endpoints, or UI.
- **Refresh tokens / session management** — single 7-day JWT; no revocation, no sessions table (noted as out of scope in `DB_SCHEMA.md §7`).
- **Rate limiting & abuse controls** — none (roadmap item).
- **Row-level security** in Postgres — none (roadmap item).
- **Admin game controls** — per-game config adjustments, round inspection, refunds/adjustments (admin is read-only reporting + payment approval today).
- **Provably-fair player verification UI** — no reveal/verify screen for players.
- **Promotions / bonuses / tournaments** — only "Coming Soon" stubs in the lobby.
- **Customer support** — WhatsApp/Telegram/live-chat are `setToast('…coming soon')` stubs.
- **Sportsbook** — "Sports" nav is a coming-soon stub.
- **Automated tests** — backend has no test suite (`npm test` prints "no test specified"); only smoke/verifier scripts. Web/admin have no tests. Mobile has only the default `widget_test.dart`.
- **Backend linting** — no ESLint config/script for `backend` (web/admin have `eslint`).
- **Multi-currency / fiat↔crypto** — only a single "USD"-style numeric balance.

---

## 7. How to Run the Project

### Prerequisites
- Node.js 20+ and npm · Docker Desktop (for Postgres) · (optional) Flutter SDK 3.4+ for mobile.

### Option A — Dev stack with Docker (Postgres + API)
```bash
cd "c:\Users\Rayhan Tawsiyat\Desktop\on shot\casino-platform"
docker compose up -d                     # postgres:5432, backend:3000
curl http://localhost:3000/health        # {"status":"ok"}
```
Then apply migrations (sequential, idempotent — `scripts/migrate.sh` applies all in sorted order):
```bash
psql "postgresql://postgres:postgres@localhost:5432/casino" -f backend/migrations/001_initial_schema.sql
# …repeat for 002 … 021
```

### Option B — Run apps locally
```bash
# Backend
cd backend
Copy-Item .env.example .env              # .env is not currently present
npm install                              # node_modules already present in repo
npm run dev                              # tsx watch on :3000

# Web player
cd ../web
Copy-Item .env.example .env              # VITE_API_URL=http://localhost:3000/api
npm run dev                              # Vite on http://localhost:5173

# Admin
cd ../admin
Copy-Item .env.example .env
npm run dev                              # Vite on http://localhost:5174

# Mobile (needs Flutter SDK + `flutter create .` once to regen Gradle wrapper)
cd ../mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api
```

### Environment variables
| Var | Where | Purpose | Default |
| --- | --- | --- | --- |
| `PORT` | backend | API port | `3000` |
| `DATABASE_URL` | backend | Postgres DSN | `postgresql://postgres:postgres@localhost:5432/casino` (dev) |
| `JWT_SECRET` | backend | JWT signing (production enforces ≥32 chars) | `change-me` (dev) |
| `CORS_ORIGIN` | backend | comma-separated allowed origins (empty = allow all) | empty |
| `VITE_API_URL` | web/admin | API base URL baked at build | `http://localhost:3000/api` |
| `API_BASE_URL` (dart-define) | mobile | API base URL | `http://10.0.2.2:3000/api` |

Production runs via `docker compose -f docker-compose.prod.yml up -d --build` after
`Copy-Item .env.production .env` and filling in the `__CHANGE_ME__` secrets (JWT ≥32 chars).

### First admin account
```bash
curl -X POST localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d '{"phone":"+8801700000001","password":"admin123"}'
psql "postgresql://postgres:postgres@localhost:5432/casino" \
  -c "UPDATE users SET role='admin' WHERE phone='+8801700000001';"
```

### Setup notes / detected gaps
- `.env` files are **not** present in `backend`/`web`/`admin` — copy from `.env.example` first.
- `node_modules` are already present for `backend`, `web`, `admin`, `desktop`.
- Mobile has **no `.dart_tool`/Gradle wrapper** — SDK was never run; regenerate via `flutter create .` from `mobile/`.

## 8. Risks / Concerns / Code Smells

1. **RESOLVED (was CRITICAL) — self-credit vulnerability.** `POST /api/wallet/deposit` (and
   `/withdraw`) are now gated to non-production: a `devWalletOnly` middleware returns 404 unless
   `ENABLE_DEV_WALLET_ENDPOINTS=true` (see `wallet.routes.ts` + `config/env.ts`). The remaining
   duplicate `wallet/deposit|withdraw` vs `payment/*` path is noted in §5 #6/#7.
2. **Broken lobby tile — Fortune Gems.** Listed as `active` / `path: '/fortune-gems'` in
   `Lobby.tsx` but no page/route exists → navigation silently redirects to `/`.
3. **Overlapping wallet vs payment deposit/withdraw.** Two code paths with different semantics;
   easy to misuse (and item #1 is a direct consequence).
4. **No automated tests for the money path.** Ledger/game settlement is the most safety-critical
   code but is only covered by ad-hoc smoke scripts; no unit/integration test runner.
5. **Provably-fair is verifiable-in-name-only.** Commitment hashes are stored, but without
   client-seed/nonce persistence + a reveal endpoint, players can't independently verify outcomes.
6. **No rate limiting / refresh tokens / RLS.** A 7-day non-revocable JWT + no rate limiting is
   risky for a real casino; noted in the repo's own roadmap.
7. **Migration numbering gap.** `backend/migrations/` jumps from `017_*` to `019_*` (no `018`).
   `migrate.sh` sorts by filename so it still works, but the gap suggests a deleted/renumbered
   migration and should be explained.
8. **Stale docs.** `docs/README.md` still says the project is "scaffolding only … not implemented
   yet", contradicting the actual state (and the detailed `README.md`/`ARCHITECTURE.md`).
9. **Desktop is a dead directory.** Electron is declared but there is no source — either build it
   or delete the folder to avoid confusion.
10. **Mobile is unverified.** The Flutter app was "written by hand" and never compiled (no Flutter
    SDK on the original machine); needs `flutter analyze`/`flutter run` before it can be trusted.
11. **Backend has no lint script.** Web/admin lint via ESLint; backend only type-checks via `tsc`.

---

## 9. Recommended Next Steps

Ordered by risk/impact:

1. ✅ **DONE — Close the self-credit hole.** `POST /api/wallet/deposit` & `/withdraw` are now gated
   by `devWalletOnly` in `backend/src/modules/wallet/wallet.routes.ts`: they return 404 in
   production unless `ENABLE_DEV_WALLET_ENDPOINTS=true`. New flag lives in
   `backend/src/config/env.ts` (defaults false, documented in `backend/.env.example` and
   `.env.production`). `/api/wallet/balance` is untouched. Optional follow-up remains: delete the
   duplicate wallet-vs-payment deposit/withdraw path entirely.
2. **Fix the Fortune Gems web page.** Small and self-contained: backend + types are done — add
   `web/src/pages/FortuneGems.tsx` and a `/fortune-gems` route (mirroring BoxingKing/FruitBonanza).
3. **Add a transaction/bet history endpoint + UI.** `GET /wallet/transactions` (or reuse the admin
   query) and a player "History" page; also unblocks the "Bet history" roadmap item.
4. **Stand up a real test suite for ledger & game settlement.** Unit tests around
   `wallet.service.ts`, `payment.service.ts`, `admin.service.ts`, and at least one provably-fair
   game + RTP invariants (the verifier scripts are a good reference).
5. **Complete provably-fair verification.** Persist `client_seed`/`nonce`, add a reveal endpoint,
   and a player-facing verify screen.
6. **Integrate a real payment gateway** (bKash first, per the README) + webhooks to replace the
   manual `payment_requests` bridge.
7. **Security hardening** — rate limiting, refresh tokens (or short-lived tokens + revocation),
   Postgres RLS, and removing the dev "direct deposit" endpoints before real money.
8. **Decide on mobile/desktop.** Either build out the remaining mobile game tiles or defer; and
   either implement or delete the `desktop/` stub.
9. **Refresh stale docs** (`docs/README.md`) and document the migration `018` gap.

---

*This document reflects the state of the repo at commit `a73f9c9` (branch `main`).*
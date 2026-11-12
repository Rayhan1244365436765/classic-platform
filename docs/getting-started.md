# Getting Started

## Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for PostgreSQL and the containerised API)
- Flutter SDK 3.4+ with an Android device or emulator (mobile only)

## 1. Database and API with Docker Compose

```bash
docker compose up -d
curl http://localhost:3000/health
# {"status":"ok"}
```

Then apply both migrations (they are sequential and idempotent):

```bash
psql "$DATABASE_URL" -f backend/migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f backend/migrations/002_payment_requests.sql
```

PostgreSQL 16 is exposed on `localhost:5432` with `postgres` / `postgres` and database `casino`.
Data is persisted in the `pgdata` volume; remove it with `docker compose down -v`.

## 2. Backend without Docker

```bash
cd backend
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm install
npm run dev                 # nodemon + ts-node on port 3000
```

## 3. Web player app

```bash
cd web
npm install
npm run dev                 # Vite dev server (http://localhost:5173)
```

## 4. Admin dashboard

```bash
cd admin
npm install
npm run dev                 # Vite dev server (http://localhost:5174)
```

The app stores its JWT under `admin_token` (separate from the player app's `token`) and only accepts
accounts whose `role` is `admin`. To create one, register normally and promote the account:

```bash
curl -X POST localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d '{"phone":"+8801700000001","password":"admin123"}'

psql "$DATABASE_URL" -c "UPDATE users SET role = 'admin' WHERE phone = '+8801700000001';"
```

The admin API is read-only: `GET /api/admin/stats`, `/api/admin/users`, `/api/admin/transactions`
(all require both `authGuard` and `adminGuard`).

## 5. Mobile app

```bash
cd mobile
flutter pub get
flutter run          # with the API + Postgres running
```

The app talks to `http://10.0.2.2:3000/api` — `10.0.2.2` is how the Android emulator
reaches the host machine's `localhost`. On a physical device, pass your machine's LAN IP:

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.1.5:3000/api
```

Dependencies: `dio` (HTTP), `provider` (state), `shared_preferences` (JWT storage).

If the Gradle wrapper is missing, generate the platform files once:

```bash
flutter create . --org com.casinoplatform --project-name casino_mobile
flutter pub get
```

## Useful commands

| Task | Command |
| --- | --- |
| Type-check and build the API | `cd backend && npm run build` |
| Lint the React apps | `cd web && npm run lint` / `cd admin && npm run lint` |
| Run Flutter widget tests | `cd mobile && flutter test` |

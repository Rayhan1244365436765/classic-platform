# Deployment Guide

How to take this monorepo from `localhost` to a public environment. **This is a roadmap, not
runnable infrastructure** — no CI/CD pipelines or provider configs are included yet.

## 1. What gets deployed

| Piece | What it is | Needs |
| --- | --- | --- |
| **Database** | PostgreSQL 16 | a managed Postgres instance (or a volume-backed container) |
| **Backend API** | stateless Node.js/Express container | Postgres connection string, `JWT_SECRET`, public HTTPS |
| **Web player app** | static Vite build (`web/dist`) | static hosting + the API URL at build time |
| **Admin dashboard** | static Vite build (`admin/dist`) | static hosting (ideally on a *different* hostname) |
| **Mobile app** | Flutter Android build | Google Play / direct APK distribution |

There is **no server-side session store**: the API is stateless and the JWT is the session, so the
backend can run as N replicas behind a load balancer without sticky sessions.

```
   players ──▶ web (static CDN)  ─┐
                                  ├─▶ backend API (HTTPS) ──▶ PostgreSQL (private network)
 operators ─▶ admin (static CDN) ─┘            │
   mobile  ──▶ android app ─────────────────────┘
```

## 2. Before you deploy

1. **Rotate the secrets.** `JWT_SECRET=change-me` is a placeholder. Generate something strong:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
2. **Use TLS everywhere.** The mobile manifest currently allows cleartext traffic for local dev
   (`android:usesCleartextTraffic="true"`); remove it and use an `https://` API URL for release.
3. **Production database rules.** Use a dedicated role (not `postgres`), restrict network access to
   the backend only, enable automated backups + PITR, and never expose `5432` publicly.
4. **Run the migrations once** against the production database, in order (`001`, then `002`). They
   are written to be idempotent (`CREATE TABLE IF NOT EXISTS`), so re-running is safe.
5. **CORS.** The API currently enables `cors()` for all origins. Before launch, restrict it to the
   deployed web/admin hostnames.
6. **Add rate limiting** (e.g. `express-rate-limit`) at least on `/api/auth/*`, and consider
   `helmet`'s stricter HSTS/CSP settings behind HTTPS.

## 3. Database (pick one)

| Option | Notes |
| --- | --- |
| **Render Postgres** | managed, automatic backups, internal connection string — simplest pairing with a Render API |
| **Railway Postgres** | one-click, same project as the API, internal URL |
| **DigitalOcean Managed Databases** | regional, private VPC networking, good for a droplet-based API |
| **Neon / Supabase** | serverless Postgres; fine for the MVP, mind connection pooling (`pgbouncer`) |

Whichever you choose, copy the connection string into the backend's `DATABASE_URL`:

```
postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

> **Pooling:** the API creates a `pg.Pool` per process. Serverless hosts with many short-lived
> instances need a pooler in front of Postgres, otherwise connections are exhausted quickly.

## 4. Backend API — Render or Railway

`backend/Dockerfile` already builds the service (`node:20-alpine`, `npm install`, `npm run dev`).

**Stage 1 – make the image production-ready**

- Switch `CMD` to run the compiled build: `npm run build` at image build time, then
  `CMD ["node", "dist/index.js"]` (and install with `npm ci`).
- Add a `.dockerignore` (`node_modules`, `dist`, `.env`).
- Health check: `GET /health` → `{"status":"ok"}`.

**Stage 2 – deploy**

1. Create a Web Service from the repo, root directory `backend/`, using the Dockerfile.
2. Environment variables: `DATABASE_URL`, `JWT_SECRET`, `PORT` (most hosts inject `PORT` — the app
   already reads it from the environment).
3. Attach the managed Postgres (internal URL, not the public one).
4. Deploy, then confirm `https://<api-host>/health` returns `{"status":"ok"}`.
5. Apply migrations against production from your machine or a one-off job:
   `psql "$DATABASE_URL" -f backend/migrations/001_initial_schema.sql` (then `002`).

**DigitalOcean alternative:** a small droplet (or App Platform) running `docker compose` is enough
for the MVP; put Caddy/nginx in front for automatic HTTPS, and keep Postgres in a managed cluster.

## 5. Web player app — Vercel or Netlify

The app is a static SPA (`vite build` → `web/dist`).

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Env var | `VITE_API_URL=https://<api-host>/api` |

- `VITE_API_URL` is baked in at **build time** — changing it requires a redeploy.
- Add an SPA rewrite so client-side routes work on refresh: Vercel (`{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`) or Netlify (`/* /index.html 200`).
- Because the app stores its JWT in `localStorage`, serve it over HTTPS only.

## 6. Admin dashboard — Vercel or Netlify

Identical to the web app with `admin` as the root directory and the same `VITE_API_URL`.

Recommendations:

- Deploy to a **separate hostname** (e.g. `admin.example.com`) so operator links are never confused
  with the player site, and so you can add IP allow-listing later.
- Keep it out of search indexes (remove it from sitemaps / add `X-Robots-Tag: noindex`).
- Consider putting it behind Cloudflare Access or a VPN before it holds real money.

## 7. Mobile app — Play Store / APK

1. In `mobile/`, run `flutter create . --org com.casinoplatform --project-name casino_mobile` once to
   generate the Gradle wrapper.
2. Remove `android:usesCleartextTraffic="true"` from `android/app/src/main/AndroidManifest.xml` and
   point the API at `https://<api-host>/api`:
   `flutter build apk --release --dart-define=API_BASE_URL=https://<api-host>/api`
3. Create an upload keystore, configure `android/key.properties` + signing config, then
   `flutter build appbundle --release` for Play Console.
4. Bump `version:` in `pubspec.yaml` for each release.

## 8. Going-live checklist

- [ ] Strong `JWT_SECRET` set on the host (never in git).
- [ ] Migrations applied to the production database; a backup taken first.
- [ ] `GET /health` reachable over HTTPS; the DB is not publicly accessible.
- [ ] First admin created (register + `UPDATE users SET role='admin'`).
- [ ] `VITE_API_URL` points at the production API in both web and admin builds.
- [ ] CORS restricted to the deployed hostnames.
- [ ] Rate limiting on auth + payment endpoints.
- [ ] Manual payment approval flow tested end-to-end with a small real amount.
- [ ] Wallet ledger spot-checked: every balance equals `SUM(amount)` of completed rows.
- [ ] `android:usesCleartextTraffic` removed; app talks HTTPS only.
- [ ] Logging/monitoring + error tracking wired up (e.g. Sentry) and uptime checks on `/health`.
- [ ] Legal: licensing, KYC/AML, responsible-gambling and age-verification requirements for your
      jurisdiction.

## 9. Suggested order of work

1. Managed Postgres + migrations.
2. Backend on Render/Railway (HTTPS + env vars) → verify `/health`.
3. Web on Vercel/Netlify pointed at the API → register, deposit, play, withdraw.
4. Admin on its own hostname → approve the deposit, confirm the balance moved.
5. Mobile release build → smoke-test the same flow on a device.
6. Then harden: rate limits, refresh tokens, monitoring, backups drills.


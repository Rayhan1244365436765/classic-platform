# DEPLOY CHECKLIST — rb1920.com

> Step-by-step guide for shipping new commits to the production VPS.
> Commands marked **LOCALLY** run on your dev machine; everything else runs **on the
> server** (`/opt/casino-platform`).

## 0. Pre-flight (recommended)
- [ ] Local `git status` is clean and all work is committed.
- [ ] Take a DB backup **before** deploying (one-liner below under "Backups").

## 1. Push the new commits (LOCALLY)
```bash
git push origin main
```

## 2. Pull on the server
```bash
cd /opt/casino-platform
git pull
```

## 3. Database migrations (idempotent)
Migrations are applied automatically by the deploy command (step 4). To run them
explicitly first and verify:
```bash
docker compose -f docker-compose.prod.yml run --rm migrate
# Expected output ends with: "[migrate] done — N applied, M already up to date"
```
The runner tracks applied files in `schema_migrations`, so it only ever applies new
ones (e.g. `021_fortune_gems.sql`, `022_game_configs.sql`).

## 4. Rebuild + restart
This runs `migrate` → `backend` → `nginx` in dependency order (healthcheck-gated):
```bash
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
```

## 5. Verify the deploy
```bash
docker compose -f docker-compose.prod.yml ps                       # all healthy
docker compose -f docker-compose.prod.yml logs --tail=50 backend   # no [env] or crash
curl -s https://rb1920.com/health                                  # {"status":"ok"}
```

## 6. Rollback (if something breaks)
Migrations are **additive/forward-only**, so rollback is a pure code rebuild:
```bash
git rev-parse HEAD                                  # note this BEFORE deploying
git reset --hard <last-good-commit>                 # e.g. the previous hash
docker compose -f docker-compose.prod.yml up -d --build
```

## Safety rules
- **NEVER** run `docker compose down -v` — it deletes the `casino_pgdata` volume (the DB).
- Keep `.env` out of git (`chmod 600`); only edit `.env.production` placeholders.
- The API drains in-flight requests on `SIGTERM` (up to 10 s), so redeploys can't cut a bet.

## Backups
```bash
mkdir -p /opt/backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d casino -Fc > /opt/backups/casino-$(date +%F-%H%M).dump
# restore:
docker compose -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U postgres -d casino --clean --if-exists < /opt/backups/casino-YYYY-MM-DD-HHMM.dump
docker compose -f docker-compose.prod.yml start backend
```
Schedule it (e.g. `0 4 * * *`) and copy dumps **off the server**.

## Troubleshooting quick refs
| Symptom | Fix |
| --- | --- |
| `migrate` exited non-zero | `docker compose -f … logs migrate` — nothing after the failing file was applied |
| nginx 502 on `/api` | backend not up yet — `docker compose -f … logs backend` |
| old bundle after deploy | hard reload; SPA shell is served `no-cache` |
# Deploying the Casino Platform to a Cloud VPS (Ubuntu)

Everything below targets a fresh **Ubuntu 22.04 / 24.04 LTS** server with
**4 vCPU / 8 GB RAM** and a public IPv4 address. The stack is four containers:

| Container  | Role | Public? |
| ---------- | ---- | ------- |
| `nginx`    | Serves the player app **and** the admin panel, proxies `/api` | **yes** (80/443) |
| `backend`  | Node API (`node dist/index.js`) on :3000 | no |
| `migrate`  | One-shot job that applies SQL migrations, then exits | no |
| `postgres` | Postgres 16, data on the `pgdata` volume | no |

Only nginx publishes ports. The database and the API are reachable only inside the
private `casino_net` network.

Files involved:

```
docker-compose.prod.yml     the stack
nginx/Dockerfile            builds web + admin, bakes them into nginx
nginx/default.conf          routing, caching, TLS (commented until Certbot runs)
backend/Dockerfile.prod     multi-stage API image
backend/scripts/migrate.sh  idempotent migration runner
.env.production             environment template (placeholders only)
```

---

## 1. Install Docker and Docker Compose

```bash
# Docker's official convenience script (adds the apt repo, installs docker-ce,
# containerd and the compose plugin).
curl -fsSL https://get.docker.com | sudo sh

# Run docker without sudo (log out and back in for the group to apply).
sudo usermod -aG docker "$USER"

# Verify (compose v2 ships as a docker subcommand, so no docker-compose binary).
docker --version
docker compose version
```

Enable it on boot:

```bash
sudo systemctl enable --now docker
```

Optional but recommended on a fresh box:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git ufw
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## 2. Clone the repository

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone <YOUR_REPO_URL> casino-platform
sudo chown -R "$USER":"$USER" /opt/casino-platform
cd /opt/casino-platform
```

---

## 3. Configure the environment

```bash
cp .env.production .env

# One placeholder covers both the Postgres password and the DATABASE_URL, so a
# single replace keeps them in sync.
sed -i "s|__CHANGE_ME__|$(openssl rand -base64 24 | tr -d '/+=')|g" .env

# The API refuses to start with the template value or anything under 32 chars.
sed -i "s|__CHANGE_ME_JWT__|$(openssl rand -hex 32)|" .env

chmod 600 .env
```

Check it before going further — the password in `DATABASE_URL` must match
`POSTGRES_PASSWORD`, and the host must be `postgres` (the service name), not
`localhost`:

```bash
grep -E '^(DATABASE_URL|POSTGRES_|JWT_SECRET|NODE_ENV|PORT)' .env
```

> `.env` is gitignored. `.env.production` is the committed template and must never
> contain real secrets.

If a browser on **another** origin will call the API directly, set
`CORS_ORIGIN=https://example.com`. With the default setup (nginx serves the apps and
the API on the same origin) leave it empty.

---

## 4. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Startup order is enforced by healthchecks, not luck:

1. `postgres` becomes healthy (`pg_isready`).
2. `migrate` applies every pending SQL file and **exits 0**.
3. `backend` starts only after `migrate` completed successfully.
4. `nginx` serves the frontends and proxies `/api`.

The first build takes a few minutes (three `npm ci` runs, two Vite builds, one
`tsc`). Watch it come up:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend nginx
```

A healthy API logs:

```
Casino Platform API listening on port 3000 (production)
```

Smoke-test from the server itself:

```bash
curl -s http://localhost/health                              # {"status":"ok"} via nginx
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/   # 200 (player app)
```

---

## 5. Database migrations

They run automatically (the `migrate` service) on every `up`. To run them
explicitly — after pulling a release, for example:

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
```

The runner records what it applied:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U postgres -d casino -c 'table schema_migrations;'
```

It is safe to re-run: already-applied files are skipped, and a file that fails
stops the run before anything after it is applied.

---

## 6. Create the first administrator

The API has no "create admin" endpoint on purpose — an operator is a normal
account promoted in the database.

1. Register in the player app (`http://<server-ip>/`) with the phone number you
   want to use for administration.
2. Promote it:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U postgres -d casino -c \
  "UPDATE users SET role = 'admin' WHERE phone = '01700000000' RETURNING id, phone, role;"
```

3. Sign in to the admin panel at `http://admin.<your-domain>/` with that phone and
   password. A non-admin account gets `403 Administrator role required.` — the
   guard is server-side, not a hidden menu.

Handy database access:

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d casino
```

---

## 7. Domain and HTTPS (Certbot)

### 7.1 DNS

Create **A records** pointing at the server's public IP:

| Name | Value |
| ---- | ----- |
| `example.com` | `203.0.113.10` |
| `www.example.com` | `203.0.113.10` |
| `admin.example.com` | `203.0.113.10` |

Verify propagation before requesting a certificate (Certbot fails otherwise):

```bash
dig +short example.com admin.example.com
```

### 7.2 Put your domain in the nginx config

```bash
sed -i 's/example\.com/yourdomain.com/g' nginx/default.conf
docker compose -f docker-compose.prod.yml exec nginx nginx -t      # syntax check
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

### 7.3 Issue the certificate

The ACME challenge is served from the mounted `./certbot/www` webroot, so port 80
never has to be freed:

```bash
mkdir -p certbot/conf certbot/www

docker run --rm \
  -v "$PWD/certbot/conf:/etc/letsencrypt" \
  -v "$PWD/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  --email you@example.com --agree-tos --no-eff-email \
  -d example.com -d www.example.com -d admin.example.com
```

> Add `--dry-run` for a rehearsal that does not consume the rate limit.

### 7.4 Enable TLS

Uncomment everything between `# ==== HTTPS` and the final redirect server at the
bottom of `nginx/default.conf`, then:

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -t
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

Open `https://example.com` — the padlock should be green. Once it is, replace the
two port-80 `server` blocks with the commented redirect block so plain HTTP
bounces to HTTPS.

### 7.5 Renewal

```bash
docker compose -f docker-compose.prod.yml --profile tls up -d certbot
```

It calls `certbot renew` twice a day. nginx only rereads certificate files on
reload, so schedule one after renewal:

```bash
(crontab -l 2>/dev/null; echo "15 3 * * * cd /opt/casino-platform && docker compose -f docker-compose.prod.yml exec -T nginx nginx -s reload") | crontab -
```

---

## 8. Day-2 operations

### Update a deployment

```bash
cd /opt/casino-platform
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
```

The API drains in-flight requests on `SIGTERM` (up to 10 s), so a redeploy cannot
cut a bet mid-transaction.

### Logs

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=100 backend
docker compose -f docker-compose.prod.yml logs -f nginx
```

### Backups (do this before you need it)

```bash
mkdir -p /opt/backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d casino -Fc > /opt/backups/casino-$(date +%F-%H%M).dump
```

Restore:

```bash
docker compose -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U postgres -d casino --clean --if-exists < /opt/backups/casino-YYYY-MM-DD-HHMM.dump
docker compose -f docker-compose.prod.yml start backend
```

Schedule it (`0 4 * * *`) **and** copy the dumps off the server — a backup on the
same disk is not a backup.

### Resource notes for 4 vCPU / 8 GB

The stack idles around 400–600 MB; nginx and Postgres dominate. `pgdata` lives in
the `casino_pgdata` volume, so **never** run `docker compose down -v`.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| Backend restarts in a loop, `[env] DATABASE_URL must be set` | no `.env`, or compose run from another directory | `cp .env.production .env`, fill it in, run from the repo root |
| `[env] JWT_SECRET must be at least 32 characters` | template value left in place | set a real secret (§3) |
| `password authentication failed for user "postgres"` | `DATABASE_URL` password ≠ `POSTGRES_PASSWORD` | they must match — re-run the `sed` for **both** |
| nginx 502 on `/api` | backend not up yet, or crashed | `logs backend`, then `ps` |
| Old bundle after a deploy | browser cache | hard reload; the SPA shell is served `no-cache` |
| `migrate` exited non-zero | a SQL file failed | read its log — nothing after the failing file was applied |
| Admin login returns 403 | account is not an admin | run the `UPDATE users SET role='admin'` from §6 |
| Certbot: `Timeout during connect` | DNS not pointing here, or port 80 blocked | `dig +short domain`, `ufw status` |

Useful one-liners:

```bash
docker compose -f docker-compose.prod.yml ps                  # health at a glance
docker compose -f docker-compose.prod.yml exec nginx nginx -t # config check
docker stats --no-stream                                      # resource use
```

---

## 10. Security checklist

- [ ] `.env` created, `chmod 600`, real secrets, never committed
- [ ] `JWT_SECRET` ≥ 32 random characters (the API enforces it)
- [ ] Postgres has **no** published port
- [ ] `ufw` allows only 22 / 80 / 443
- [ ] TLS enabled and HTTP redirects to HTTPS
- [ ] Admin panel on its own hostname (`noindex` header set)
- [ ] Backups scheduled **and** copied off the machine
- [ ] `docker compose down` never used with `-v`


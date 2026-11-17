#!/bin/sh
# =============================================================================
# Applies every SQL file in /migrations, in filename order, exactly once.
#
#   docker compose -f docker-compose.prod.yml run --rm migrate
#
# Why a ledger: most migrations use IF NOT EXISTS, but not all of them are
# idempotent, so blindly re-running every file after a deploy would fail. The
# `schema_migrations` table records what has been applied; anything new is run
# inside its own transaction and recorded only on success.
#
# Each file manages its own BEGIN/COMMIT (several do), so this script never wraps
# them in an outer transaction — that way a half-applied file can never be marked
# as done.
# =============================================================================
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

echo "[migrate] waiting for the database…"
attempt=0
until psql "$DATABASE_URL" -q -c 'select 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "[migrate] database unreachable after 30 attempts" >&2
    exit 1
  fi
  sleep 2
done

echo "[migrate] connected"

# Ledger of applied files.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

applied=0
skipped=0

# `sort` guarantees 001, 002, … 020 order regardless of filesystem order.
for file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  name=$(basename "$file")

  already=$(psql "$DATABASE_URL" -tAc "select 1 from schema_migrations where filename = '$name'")
  if [ "$already" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "[migrate] applying $name"
  if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$file"; then
    echo "[migrate] FAILED on $name — nothing after it was applied" >&2
    exit 1
  fi

  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
    -c "insert into schema_migrations (filename) values ('$name') on conflict do nothing"
  applied=$((applied + 1))
done

echo "[migrate] done — $applied applied, $skipped already up to date"

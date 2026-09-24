#!/bin/sh
set -eu

SCHEMA=/app/packages/database/prisma/schema.prisma
PG_USER="${POSTGRES_USER:-revendedor}"
PG_DB="${POSTGRES_DB:-revendedor}"
PG_HOST="${POSTGRES_HOST:-postgres}"
PG_PORT="${POSTGRES_PORT:-5432}"

# Monta URLs com senha URL-encoded (#, @, etc. não quebram o Prisma)
eval "$(node <<'NODE'
const enc = encodeURIComponent;
const user = process.env.POSTGRES_USER || "revendedor";
const db = process.env.POSTGRES_DB || "revendedor";
const host = process.env.POSTGRES_HOST || "postgres";
const port = process.env.POSTGRES_PORT || "5432";
const adminPass = process.env.POSTGRES_PASSWORD || "";
const appPass = process.env.APP_DB_PASSWORD || "";
if (!adminPass) {
  console.error("POSTGRES_PASSWORD is required");
  process.exit(1);
}
if (!appPass) {
  console.error("APP_DB_PASSWORD is required");
  process.exit(1);
}
const adminUrl = `postgresql://${enc(user)}:${enc(adminPass)}@${host}:${port}/${enc(db)}?schema=public`;
const appUrl = `postgresql://revendedor_app:${enc(appPass)}@${host}:${port}/${enc(db)}?schema=public`;
// Escape for shell single-quotes
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
console.log(`export DATABASE_URL_ADMIN=${q(adminUrl)}`);
console.log(`export DATABASE_URL=${q(appUrl)}`);
NODE
)"

echo "[api] applying migrations..."
i=0
until DATABASE_URL="$DATABASE_URL_ADMIN" npx --yes prisma migrate deploy --schema "$SCHEMA"; do
  i=$((i + 1))
  if [ "$i" -gt 40 ]; then
    echo "[api] database unavailable after retries"
    exit 1
  fi
  echo "[api] waiting for postgres... ($i)"
  sleep 3
done

echo "[api] updating revendedor_app password..."
DATABASE_URL="$DATABASE_URL_ADMIN" node /app/scripts/sync-app-db-password.mjs

echo "[api] starting server..."
cd /app/apps/api
export DATABASE_URL
export DATABASE_URL_ADMIN
exec npx tsx src/index.ts

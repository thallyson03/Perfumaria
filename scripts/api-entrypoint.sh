#!/bin/sh
set -eu

SCHEMA=/app/packages/database/prisma/schema.prisma
ADMIN_URL="${DATABASE_URL_ADMIN:-$DATABASE_URL}"

echo "[api] applying migrations..."
i=0
until DATABASE_URL="$ADMIN_URL" npx --yes prisma migrate deploy --schema "$SCHEMA"; do
  i=$((i + 1))
  if [ "$i" -gt 40 ]; then
    echo "[api] database unavailable after retries"
    exit 1
  fi
  echo "[api] waiting for postgres... ($i)"
  sleep 3
done

if [ -n "${APP_DB_PASSWORD:-}" ]; then
  echo "[api] updating revendedor_app password..."
  DATABASE_URL="$ADMIN_URL" node /app/scripts/sync-app-db-password.mjs
fi

echo "[api] starting server..."
cd /app/apps/api
exec npx tsx src/index.ts

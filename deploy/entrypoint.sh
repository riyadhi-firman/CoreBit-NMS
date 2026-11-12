#!/bin/sh
set -e

echo "[CoreBit] Starting..."

# Parse DATABASE_URL if PG* variables are not set
# This allows users to only set DATABASE_URL instead of both
if [ -n "$DATABASE_URL" ] && [ -z "$PGHOST" ]; then
  # Extract components from DATABASE_URL (format: postgresql://user:pass@host:port/database)
  # Remove the protocol prefix
  DB_PART="${DATABASE_URL#postgresql://}"
  DB_PART="${DB_PART#postgres://}"
  
  # Extract user:pass@host:port/database
  USERPASS="${DB_PART%%@*}"
  HOSTPORTDB="${DB_PART#*@}"
  
  # Extract user and password
  export PGUSER="${USERPASS%%:*}"
  PGPASSWORD_TEMP="${USERPASS#*:}"
  export PGPASSWORD="${PGPASSWORD_TEMP}"
  
  # Extract host:port and database
  HOSTPORT="${HOSTPORTDB%%/*}"
  export PGDATABASE="${HOSTPORTDB#*/}"
  
  # Extract host and port
  export PGHOST="${HOSTPORT%%:*}"
  if echo "$HOSTPORT" | grep -q ':'; then
    export PGPORT="${HOSTPORT#*:}"
  else
    export PGPORT="5432"
  fi
  
  echo "[CoreBit] Parsed DATABASE_URL -> PGHOST=$PGHOST PGPORT=$PGPORT PGUSER=$PGUSER PGDATABASE=$PGDATABASE"
fi

# Wait for database to be ready
echo "[CoreBit] Waiting for database..."
until pg_isready -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-corebit}" 2>/dev/null; do
  echo "[CoreBit] Database not ready, waiting..."
  sleep 2
done
echo "[CoreBit] Database is ready"

# Run database migrations using the safe idempotent SQL file.
# This uses CREATE TABLE IF NOT EXISTS and ALTER TABLE ... ADD COLUMN IF NOT EXISTS
# which are safe to run repeatedly and will never drop or truncate tables.
#
# NOTE: drizzle-kit push --force is intentionally NOT used here.
# In drizzle-kit 0.31+, --force bypasses ALL confirmation prompts including
# destructive DROP TABLE / RECREATE TABLE operations, which silently wipes data.
echo "[CoreBit] Applying database migrations..."
if [ -f "./deploy/migrations.sql" ]; then
  psql -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-corebit}" -d "${PGDATABASE:-corebit}" \
    -f ./deploy/migrations.sql 2>&1 || {
    echo "[CoreBit] Migration SQL had warnings (likely already applied) — continuing..."
  }
  echo "[CoreBit] Migrations applied"
else
  echo "[CoreBit] migrations.sql not found, skipping SQL migrations"
fi

echo "[CoreBit] Starting application..."
exec node dist/index.js

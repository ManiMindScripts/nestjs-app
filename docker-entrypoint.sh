#!/bin/sh
set -e

if [ "${MIGRATE_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Running database migrations..."
  ./node_modules/.bin/typeorm migration:run -d dist/database/data-source.js
fi

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Seeding roles/permissions/bootstrap admin..."
  node dist/database/seeds/seed-roles-permissions.js
fi

exec node dist/main.js
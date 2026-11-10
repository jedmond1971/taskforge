#!/bin/sh
# Mirrors railway.toml: migrate first (a failed migration must stop the container, not start the
# new code on an old schema), then serve.
set -e
npx prisma migrate deploy
exec node node_modules/.bin/next start -p "${PORT:-3000}" -H 0.0.0.0

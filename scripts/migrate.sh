#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo 'DATABASE_URL is required' >&2
  exit 2
fi

pnpm --filter @flightcheck/db db:migrate:deploy
if [[ "${RUN_SEED:-true}" == 'true' ]]; then
  pnpm --filter @flightcheck/db db:seed
fi

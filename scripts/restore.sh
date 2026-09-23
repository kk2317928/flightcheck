#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo 'usage: restore.sh DUMP_PATH' >&2
  exit 2
fi
if [[ -z "${TARGET_DATABASE_URL:-}" ]]; then
  echo 'TARGET_DATABASE_URL is required' >&2
  exit 2
fi
if [[ "${CONFIRM_RESTORE:-}" != 'flightcheck' ]]; then
  echo 'refusing restore: set CONFIRM_RESTORE=flightcheck' >&2
  exit 2
fi
command -v pg_restore >/dev/null || {
  echo 'pg_restore is required' >&2
  exit 3
}

dump_path="$1"
if [[ ! -f "$dump_path" ]]; then
  echo 'dump file does not exist' >&2
  exit 2
fi
pg_restore --list "$dump_path" >/dev/null
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$TARGET_DATABASE_URL" "$dump_path"
echo 'FlightCheck database restore completed.'

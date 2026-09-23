#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo 'DATABASE_URL is required' >&2
  exit 2
fi
if [[ $# -ne 1 || -z "$1" ]]; then
  echo 'usage: backup.sh OUTPUT_DIRECTORY' >&2
  exit 2
fi
command -v pg_dump >/dev/null || {
  echo 'pg_dump is required' >&2
  exit 3
}
command -v pg_restore >/dev/null || {
  echo 'pg_restore is required' >&2
  exit 3
}

output_directory="$1"
mkdir -p "$output_directory"
timestamp="${FLIGHTCHECK_BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ ! "$timestamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo 'invalid backup timestamp' >&2
  exit 2
fi
dump_path="$output_directory/flightcheck-$timestamp.dump"

pg_dump --format=custom --no-owner --no-privileges \
  --file="$dump_path" "$DATABASE_URL"
pg_restore --list "$dump_path" >/dev/null
printf '%s\n' "$dump_path"

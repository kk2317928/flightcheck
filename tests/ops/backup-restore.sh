#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$test_root/bin" "$test_root/backups"
tool_log="$test_root/tool.log"

cat >"$test_root/bin/pg_dump" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'pg_dump %s\n' "$*" >>"$TOOL_LOG"
for argument in "$@"; do
  case "$argument" in
    --file=*) printf 'custom dump\n' >"${argument#--file=}" ;;
  esac
done
STUB
cat >"$test_root/bin/pg_restore" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'pg_restore %s\n' "$*" >>"$TOOL_LOG"
STUB
chmod +x "$test_root/bin/pg_dump" "$test_root/bin/pg_restore"

export PATH="$test_root/bin:$PATH"
export ORIGINAL_PATH="${PATH#"$test_root/bin:"}"
export TOOL_LOG="$tool_log"
export DATABASE_URL='postgresql://user:secret@db/source'
export FLIGHTCHECK_BACKUP_TIMESTAMP='20260923T010203Z'

dump_path="$(bash "$repo_root/scripts/backup.sh" "$test_root/backups")"
expected_dump="$test_root/backups/flightcheck-20260923T010203Z.dump"
test "$dump_path" = "$expected_dump"
test -f "$expected_dump"
grep -F -- '--format=custom' "$tool_log" >/dev/null
grep -F -- "--list $expected_dump" "$tool_log" >/dev/null

if CONFIRM_RESTORE=no TARGET_DATABASE_URL='postgresql://db/target' \
  bash "$repo_root/scripts/restore.sh" "$expected_dump" >/dev/null 2>&1; then
  echo 'restore accepted an invalid confirmation' >&2
  exit 1
fi

CONFIRM_RESTORE=flightcheck TARGET_DATABASE_URL='postgresql://db/target' \
  bash "$repo_root/scripts/restore.sh" "$expected_dump"
grep -F -- '--clean --if-exists --no-owner --no-privileges' "$tool_log" >/dev/null
grep -F -- '--dbname=postgresql://db/target' "$tool_log" >/dev/null

if [[ -n "${SOURCE_DATABASE_URL:-}" && -n "${RESTORE_DATABASE_URL:-}" ]] && \
  command -v psql >/dev/null; then
  real_backup_root="$(mktemp -d)"
  DATABASE_URL="$SOURCE_DATABASE_URL" PATH="${ORIGINAL_PATH:-$PATH}" \
    bash "$repo_root/scripts/backup.sh" "$real_backup_root" >/dev/null
  real_dump="$(find "$real_backup_root" -name 'flightcheck-*.dump' -print -quit)"
  CONFIRM_RESTORE=flightcheck TARGET_DATABASE_URL="$RESTORE_DATABASE_URL" \
    PATH="${ORIGINAL_PATH:-$PATH}" bash "$repo_root/scripts/restore.sh" "$real_dump"
  for table in Flight FlightInstance ScrapeRun DailyStatistic; do
    source_count="$(psql "$SOURCE_DATABASE_URL" -Atc "SELECT COUNT(*) FROM \"$table\"")"
    restored_count="$(psql "$RESTORE_DATABASE_URL" -Atc "SELECT COUNT(*) FROM \"$table\"")"
    test "$source_count" = "$restored_count"
  done
  echo 'real backup/restore counts match'
else
  echo 'contract drill passed; real drill requires PostgreSQL clients and SOURCE_DATABASE_URL/RESTORE_DATABASE_URL'
fi

# FlightCheck Backup and Restore

Use PostgreSQL client tools from the same major version as the production
server. Both scripts fail before changing data when required inputs are absent.

## Create a backup

```bash
DATABASE_URL='postgresql://...' bash scripts/backup.sh /var/backups/flightcheck
```

The command creates a timestamped custom-format file named
`flightcheck-YYYYMMDDTHHMMSSZ.dump` and validates it with `pg_restore --list`.
Copy the dump to storage outside the application host and apply the retention
policy there.

## Restore

Restore only into an empty, explicitly selected database. `--clean --if-exists`
also makes a repeated recovery drill deterministic.

```bash
CONFIRM_RESTORE=flightcheck \
TARGET_DATABASE_URL='postgresql://.../flightcheck_restore' \
bash scripts/restore.sh /var/backups/flightcheck/flightcheck-20260923T010203Z.dump
```

Never point `TARGET_DATABASE_URL` at production during a drill. The confirmation
value is mandatory because restore removes existing objects before recreating
them.

## Recovery drill

Provide separate seeded source and empty target databases:

```bash
SOURCE_DATABASE_URL='postgresql://.../flightcheck_source' \
RESTORE_DATABASE_URL='postgresql://.../flightcheck_restore' \
bash tests/ops/backup-restore.sh
```

The drill compares row counts for `Flight`, `FlightInstance`, `ScrapeRun`, and
`DailyStatistic`. Without PostgreSQL clients or the two URLs, it still verifies
the scripts' command contract and destructive-operation guard, and reports that
the real database drill was skipped.

# FlightCheck Rollback

Application rollback selects previously built Web and Worker images. It never
reverses a database migration automatically.

## Before upgrading

```bash
docker compose exec -T worker bash scripts/backup.sh /backups
docker image inspect flightcheck-web:<current-tag> >/dev/null
docker image inspect flightcheck-worker:<current-tag> >/dev/null
```

Record the current tag and retain the database dump off-host.

## Roll back applications

```bash
FLIGHTCHECK_IMAGE_TAG=<previous-tag> docker compose up -d --no-deps web worker
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
docker compose logs --tail=100 web worker
```

Rollback Web and Worker independently when only one service regressed. Do not
run `prisma migrate reset`, delete `postgres_data`, or apply a down migration.

If the previous application is incompatible with the migrated schema, stop the
application and treat database restoration as an incident decision. Restore the
pre-upgrade dump into a new database first, verify table counts and application
health, then switch `DATABASE_URL`. Never overwrite the production database as
the first recovery action.

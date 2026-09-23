# Vercel Web + Independent Worker

## Topology

Deploy `apps/web` to the existing Vercel `flightcheck` project. Run exactly one
`worker` container on a Docker host using `compose.worker.yaml`. Both connect to
the same PostgreSQL database. The Worker polls the official airport board every
five minutes, recalculates daily statistics, and records a database heartbeat.
Vercel does not run the persistent scheduler. No inbound ports are needed on
the Worker host.

## Shared database and Web

1. Select an externally reachable PostgreSQL instance. Make sure the Worker
   host and Vercel can both connect using TLS. The two `DATABASE_URL` values may
   use different pool/direct endpoints but **must refer to the same database**.
   Keep credentials in Vercel project environment settings and the private
   `.env.worker` file, never in Git. Do not use the `db` hostname from the
   all-in-one `compose.yaml` in either environment.
2. In the Vercel `flightcheck` project, set `DATABASE_URL` for Preview and
   Production, with a pooled endpoint if the provider supplies one. The
   `apps/web` root directory and Next.js framework must point to the existing
   monorepo project settings. The Web build needs Prisma client generation;
   `apps/web/package.json` runs it before `next build`.
3. Keep the feature-branch deployment as a protected Preview until the Worker
   and database checks below pass. A `READY` deployment or `/api/health` 200
   only proves Web process health; it does not prove DB access or flight sync.
4. Publish a production deployment only after migrations, initial sync, public
   statistics, Admin login, and backup restore have been verified. Deploy the
   tested commit to Production in Vercel and inspect runtime errors.

## Worker installation

On a Linux host with Docker Engine and Compose, check out the **same commit**
as the Vercel deployment and create the private environment file:

```bash
cp .env.worker.example .env.worker
chmod 600 .env.worker
# Edit DATABASE_URL to the direct TLS PostgreSQL connection URL.
docker compose -f compose.worker.yaml --env-file .env.worker config --quiet
docker compose -f compose.worker.yaml --env-file .env.worker build migrate worker
docker compose -f compose.worker.yaml --env-file .env.worker run --rm migrate
docker compose -f compose.worker.yaml --env-file .env.worker up -d worker
docker compose -f compose.worker.yaml --env-file .env.worker ps
```

The migration job applies Prisma migrations and seeds the idempotent lookup
data. Worker startup immediately runs recovery and one sync; the scheduler then
syncs every five minutes. Keep `RUN_SEED=true` for first setup. To create the
initial administrator, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` temporarily in
the host environment, then run the bootstrap in the migration image without
writing the password to shell history:

```bash
docker compose -f compose.worker.yaml --env-file .env.worker \
  run --rm -e ADMIN_EMAIL -e ADMIN_PASSWORD --entrypoint sh migrate -lc \
  'pnpm --filter @flightcheck/web admin:create'
```

## Verification and recovery

```bash
docker compose -f compose.worker.yaml --env-file .env.worker ps
docker compose -f compose.worker.yaml --env-file .env.worker logs --tail=100 worker
docker compose -f compose.worker.yaml --env-file .env.worker exec -T worker \
  sh -c 'psql "$DATABASE_URL" -Atc "SELECT COUNT(*) FROM \"ScrapeRun\""'
docker compose -f compose.worker.yaml --env-file .env.worker exec -T worker \
  sh -c 'psql "$DATABASE_URL" -Atc "SELECT COUNT(*) FROM \"FlightInstance\""'
```

Confirm recent successful departure **and** arrival `ScrapeRun` rows and actual
NX `FlightInstance` rows before trusting public statistics. A source outage
must appear as degraded quality, not zero flights. Check the Vercel Preview
dashboard, cancellations, history, flight detail and Admin pages against the
same rows; perform a confirmed manual recalculation and compare totals.

Back up from the Worker container with `bash scripts/backup.sh /backups` and
copy dumps off-host. Follow [`backup-restore.md`](./backup-restore.md) to
restore into a separate empty database and compare counts. Run the real restore
drill before release. Upgrades must migrate first, then replace the Worker and
deploy Web from the same commit. Never run two Worker containers concurrently.

If the Worker host or external database is unavailable, the Vercel site may
still render but data freshness and quality will degrade. Monitor both Vercel
runtime errors and the database `worker-heartbeat` expiry.

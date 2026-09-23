# FlightCheck Production Deployment

For the approved Vercel Web + separate Worker setup, follow
[`vercel-worker.md`](./vercel-worker.md). The Compose instructions below deploy
all components on one VPS.

## Boundary and prerequisites

Use a Linux VPS with Docker Engine and the Compose plugin. Only Web binds to
host loopback. Terminate HTTPS in a host-level reverse proxy such as Caddy or
Nginx and proxy to `127.0.0.1:3000`; never expose PostgreSQL or Worker ports.

Copy the example environment and replace every placeholder. Inside Compose,
`DATABASE_URL` must use hostname `db`, not `localhost`.

```bash
cp .env.example .env
chmod 600 .env
```

At minimum, set a strong `POSTGRES_PASSWORD`, a matching `DATABASE_URL`, and
the initial `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Do not commit `.env`.

## First installation

```bash
docker compose --env-file .env config
docker compose build migrate web worker
docker compose up -d db
docker compose run --rm migrate
docker compose up -d web worker
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

`migrate` runs `prisma migrate deploy` and the idempotent seed. Web and Worker
wait for a successful migration. Create the first administrator without
installing Node.js on the host:

```bash
docker compose run --rm --entrypoint sh migrate -lc \
  'pnpm --filter @flightcheck/web admin:create'
```

## Health and logs

```bash
docker compose ps
docker compose logs --tail=100 web worker migrate
curl --fail http://127.0.0.1:3000/api/health
docker compose exec -T worker psql "$DATABASE_URL" -Atc \
  'SELECT "heartbeatAt", "expiresAt" FROM "JobLock" WHERE name = '\''worker-heartbeat'\'';'
```

Web checks `/api/health`. Worker health checks its persisted, unexpired
heartbeat. PostgreSQL data uses `postgres_data`; backups use `backup_data`.

## Backup before every upgrade

```bash
docker compose exec -T worker bash scripts/backup.sh /backups
docker compose exec -T worker find /backups -maxdepth 1 -name 'flightcheck-*.dump' -ls
```

Copy the newest dump off-host and follow
[`backup-restore.md`](./backup-restore.md) for the restore drill.

## Independent upgrades

Set an immutable release identifier such as a Git commit in
`FLIGHTCHECK_IMAGE_TAG`, then build only the changed service:

```bash
FLIGHTCHECK_IMAGE_TAG=<commit> docker compose build web
FLIGHTCHECK_IMAGE_TAG=<commit> docker compose up -d --no-deps web

FLIGHTCHECK_IMAGE_TAG=<commit> docker compose build worker
FLIGHTCHECK_IMAGE_TAG=<commit> docker compose up -d --no-deps worker
```

For releases containing migrations, build and run migration first, then replace
applications:

```bash
FLIGHTCHECK_IMAGE_TAG=<commit> docker compose build migrate web worker
FLIGHTCHECK_IMAGE_TAG=<commit> docker compose run --rm migrate
FLIGHTCHECK_IMAGE_TAG=<commit> docker compose up -d --no-deps web worker
```

Do not run two Worker containers concurrently. The flight-sync lease prevents
duplicate sync writes, but P0 is designed as a single persistent Worker.

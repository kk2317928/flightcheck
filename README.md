# FlightCheck

FlightCheck monitors Air Macau (`NX`) departures and arrivals from Macau International Airport, retains historical snapshots, calculates daily reliability statistics, and publishes confirmed cancellation and daily-summary events.

P0 scope is frozen in [`docs/P0_v1.2.md`](docs/P0_v1.2.md). Implementation status is tracked in [`CURRENT_STATE.md`](CURRENT_STATE.md) and [`tasks.md`](tasks.md).

## Requirements

- Node.js 22 or newer
- pnpm 11
- PostgreSQL 16 or newer

## Setup

```bash
cp .env.example .env
set -a
source .env
set +a
pnpm install --frozen-lockfile
pnpm dev
```

The Web app runs at `http://localhost:3000`. Its health endpoint is `GET /api/health`.

The Worker foundation can be built and run independently:

```bash
pnpm turbo run build --filter=@flightcheck/worker
pnpm --filter @flightcheck/worker start
```

It prints a structured `worker.ready` event with a job correlation ID and exits. Persistent scheduling starts in later Tasks.

Initialize an empty PostgreSQL database with the committed migration and idempotent seed:

```bash
pnpm --filter @flightcheck/db db:migrate:deploy
pnpm --filter @flightcheck/db db:seed
```

Rollback and destructive development rebuild procedures are documented in [`packages/db/README.md`](packages/db/README.md).

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run browser smoke tests after installing Chromium once:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## Workspace

```text
apps/web/       Next.js App Router public and Admin application
apps/worker/    persistent Node.js worker foundation
packages/shared validated configuration, Macau time and observability utilities
packages/db     PostgreSQL schema, Prisma client, migrations and seed
tests/e2e/      browser-level smoke and acceptance tests
docs/           frozen specification, implementation plan and runbooks
```

Read [`AGENTS.md`](AGENTS.md) before implementation. Work on one Task at a time and update the state files in the same commit.

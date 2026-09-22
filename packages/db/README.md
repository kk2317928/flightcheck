# FlightCheck Database

`packages/db` owns the PostgreSQL schema, Prisma client, migrations and seed data.

## Apply and seed an empty database

Set `DATABASE_URL`, then run from the repository root:

```bash
pnpm --filter @flightcheck/db db:migrate:deploy
pnpm --filter @flightcheck/db db:seed
```

Both commands are safe to rerun. The migration deploy command only applies pending migrations, and the seed uses idempotent upserts.

## Persist normalized flight observations

Create one repository from the shared Prisma client and pass an existing `ScrapeRun` ID with each normalized batch:

```ts
import {
  createFlightObservationRepository,
  createPrismaClient,
} from '@flightcheck/db';

const prisma = createPrismaClient(process.env.DATABASE_URL);
const flights = createFlightObservationRepository(prisma);

await flights.persistObservationBatch({
  scrapeRunId,
  observedAt: new Date(),
  flights: normalizedFlights,
  warnings: sourceWarnings,
});
```

The batch atomically upserts flights and flight instances, replaces warning metadata on the scrape run, and stores a snapshot only when the canonical material payload changes. Observation timestamps and scrape-run IDs do not affect the snapshot hash.

Status policy remains outside this package. T-009 calculates operational/performance status and passes both the state it evaluated and its target state to `recordStatusTransition`. The repository writes history only when the persisted state actually changes, deduplicates a target that already won, and rejects stale decisions instead of overwriting a newer state.

## Roll back an application release

Prisma production migrations are forward-only. To roll back application code, deploy the previous application version without deleting or editing an applied migration. If a schema correction is required, create and deploy a new forward migration.

Before any destructive database rollback, take and verify a PostgreSQL backup. Restoring a backup is the only supported way to reverse a destructive migration while preserving the exact earlier data state.

## Rebuild a development database

The following command is destructive and must never be used against production:

```bash
pnpm --filter @flightcheck/db db:migrate:reset
```

The package script drops the configured database schema, reapplies every migration, then explicitly runs `prisma db seed` because Prisma 7 does not seed automatically after reset. Confirm that `DATABASE_URL` points to a disposable development database before running it.

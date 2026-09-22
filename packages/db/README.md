# FlightCheck Database

`packages/db` owns the PostgreSQL schema, Prisma client, migrations and seed data.

## Apply and seed an empty database

Set `DATABASE_URL`, then run from the repository root:

```bash
pnpm --filter @flightcheck/db db:migrate:deploy
pnpm --filter @flightcheck/db db:seed
```

Both commands are safe to rerun. The migration deploy command only applies pending migrations, and the seed uses idempotent upserts.

## Roll back an application release

Prisma production migrations are forward-only. To roll back application code, deploy the previous application version without deleting or editing an applied migration. If a schema correction is required, create and deploy a new forward migration.

Before any destructive database rollback, take and verify a PostgreSQL backup. Restoring a backup is the only supported way to reverse a destructive migration while preserving the exact earlier data state.

## Rebuild a development database

The following command is destructive and must never be used against production:

```bash
pnpm --filter @flightcheck/db db:migrate:reset
```

The package script drops the configured database schema, reapplies every migration, then explicitly runs `prisma db seed` because Prisma 7 does not seed automatically after reset. Confirm that `DATABASE_URL` points to a disposable development database before running it.

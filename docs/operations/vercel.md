# Vercel First Release

## Architecture

The existing `flightcheck` Vercel project serves the Next.js Web app. A single
Vercel Cron invokes `GET /api/cron/tick` every five minutes in Production. Each
invocation uses the existing global flight-sync database lease to acquire Macau
Airport arrivals and departures and then recalculates current-day statistics.
After 00:05 through 07:00 Macau time, it also settles yesterday; this grace
window tolerates late cron execution. Vercel Cron schedules use UTC and only
run for Production deployments. The local Docker Compose files are optional
for development/recovery and **must not start another Worker against the same
production database**.

## Required project settings

Use the connected `flightcheck` project. Its configured root directory is
`apps/web`; `apps/web/vercel.json` declares the single cron job.

Set these encrypted environment variables for **Production**:

- `DATABASE_URL`: a TLS PostgreSQL connection string to the migrated FlightCheck
  database; prefer the provider's pooled runtime connection for Vercel Functions.
- `CRON_SECRET`: a unique high-entropy random secret. Vercel passes it as
  `Authorization: Bearer <secret>` when triggering its cron job. The route
  returns 401 if absent or incorrect; never place it in source control.

Set `DATABASE_URL` separately for Preview if preview pages must read a database.
Use an isolated preview database when testing mutations. Vercel controls `TZ`
as UTC; the Web adapter explicitly supplies `Asia/Macau` to shared services.
The project must support five-minute Cron scheduling (Pro or Enterprise); on a
Hobby plan this schedule is rejected during deployment. Confirm the plan before
promoting. Configure Node.js runtime and production branch in project settings.

## Migration and Admin bootstrap

Before Production promotion, run `pnpm --filter @flightcheck/db db:migrate:deploy`
and `pnpm --filter @flightcheck/db db:seed` once with the target database URL in
a secure environment. Do not run migrations automatically during Vercel's
parallel Web builds. Create the first administrator with
`pnpm --filter @flightcheck/web admin:create`, supplying `ADMIN_EMAIL` and
`ADMIN_PASSWORD` only for that command. Keep the direct migration URL private;
the Web runtime may use a separate pooled URL to the same database.

## Release checks

1. Confirm GitHub CI and Vercel Preview build for the exact commit are green.
   Browser-check the Preview dashboard and protected Admin without relying on
   preview Cron: the scheduler runs only in Production.
2. After promotion, verify `/api/health`, then verify the configured Cron in
   Vercel's Cron settings and its runtime logs. A health 200 alone does not
   confirm DB connectivity or scraping.
3. Confirm recent `ScrapeRun` rows for departures **and** arrivals, nonzero
   `FlightInstance` rows when the official source lists NX flights, and
   `DailyStatistic` totals matching the visible flight records. Failed source
   observations must show degraded quality rather than false zero flights.
4. Check Admin login, protected manual sync/recalculation, flight details,
   history and cancellations from the Production URL. Watch for 401 Cron calls,
   repeated 503 source failures, database errors and stale statistics.
5. Back up PostgreSQL and restore into a separate test database using
   [`backup-restore.md`](./backup-restore.md). Keep an offsite copy and verify
   row counts before release.

No production Cron invocation or live-data acceptance can be signed off until
the encrypted Production variables, migrations and production deployment are
present. Preview `READY` proves only the build succeeds.

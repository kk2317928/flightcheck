# FlightCheck First Release Fast Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-safe first public FlightCheck release with automatic flight sync, truthful daily statistics, public flight pages, minimum Admin operations, backup/restore, and Docker deployment.

**Architecture:** Preserve the existing package boundaries. Pure statistics and quality rules live in `packages/domain`, Prisma persistence and queries live in `packages/db`, `apps/worker` owns scheduled/recovery workflows, and `apps/web` consumes query services for public and protected Admin pages. The fast track changes release order only; social publishing remains deferred without weakening the frozen P0 rules.

**Tech Stack:** TypeScript 5.9, Node.js 22, pnpm 11, Turborepo, Next.js App Router, React, Tailwind CSS, PostgreSQL, Prisma 7, Zod, Vitest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-22-first-release-fast-track-design.md`

## Global Constraints

- Monitor only Air Macau (`NX`) flights from Macau Airport public departure and arrival boards.
- Store timestamps in UTC and resolve service dates, scheduling, and display in `Asia/Macau`.
- Statistics must be recalculated from `FlightInstance`; never maintain increment-only counters.
- Pending performance does not enter punctuality denominators; cancellation remains part of total flights.
- A zero denominator produces `null`, never `NaN`, infinity, or a fabricated zero percent.
- Failed or incomplete source coverage must never be presented as complete statistics.
- Manual sync must call the existing `FlightSyncService` and respect the global `flight-sync` lease.
- Public responses must not expose Admin audit metadata, raw warnings, internal error details, or secrets.
- Threads and Facebook are not first-release blockers and no production social post may be emitted.
- Every behavior change follows RED → GREEN → repository verification and one focused commit.

## Review Focus

- Zero flights: statistics return null rates and the public UI displays N/A without crashing.
- Partial direction: quality is DEGRADED, freshness remains visible, and totals are not described as complete.
- Same flight number across dates/directions: detail and history queries never merge distinct instances.
- Concurrent manual and scheduled sync: exactly one acquires the existing lease and the other reports locked.
- Restart during settlement or sync: recovery is idempotent and never downgrades FINAL statistics.

---

## File Responsibility Map

| Area                   | Files                                                                                                  | Responsibility                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Domain statistics      | `packages/domain/src/daily-statistics.ts`, `data-quality.ts`, `statistics-types.ts`                    | Pure aggregation and quality decisions                    |
| Statistics persistence | `packages/db/src/statistics-repository.ts`                                                             | Read source rows and atomically upsert daily results      |
| Statistics workflow    | `apps/worker/src/statistics-service.ts`, `statistics-scheduler.ts`                                     | Recalculate, settle, recover, and schedule                |
| Read models            | `packages/db/src/flight-query-repository.ts`                                                           | Validated public/Admin query results                      |
| Web query boundary     | `apps/web/src/lib/flights/query-service.ts`                                                            | Zod input parsing and public-safe DTO mapping             |
| Public UI              | `apps/web/src/app/page.tsx`, `flights/[flight]/page.tsx`, `history/page.tsx`, `cancellations/page.tsx` | Server-rendered public product                            |
| Admin operations       | `apps/web/src/app/admin/*`, `apps/web/src/app/api/admin/*`                                             | Protected visibility, manual sync, recalculation, audit   |
| Worker recovery        | `apps/worker/src/recovery.ts`, `runtime.ts`, `composition.ts`                                          | Startup cleanup, immediate work, heartbeat                |
| Operations             | `scripts/backup.sh`, `scripts/restore.sh`, `compose.yaml`, Dockerfiles, `docs/operations/*`            | Backup, restore, deployment, rollback, smoke verification |

---

### Task 1: Close CP-02 and Activate the Fast Track

**Files:**

- Modify: `tasks.md`
- Modify: `CURRENT_STATE.md`
- Modify: `docs/superpowers/specs/2026-09-22-first-release-fast-track-design.md`

**Interfaces:**

- Consumes: verified T-010 head and green CP-02 gate.
- Produces: `cp-02-flight-engine` tag and an active FR-01 ledger entry.

- [ ] **Step 1: Verify the exact remote head and CP-02 evidence**

Run: `pnpm verify`

Expected: 206 tests pass; all six package lint, typecheck, and build tasks pass.

- [ ] **Step 2: Update the durable ledgers**

Set the CP-02 tag gate to complete, add FR-01 through FR-04 sections, mark FR-01 active, and record that the full T-001–T-032 backlog remains authoritative.

- [ ] **Step 3: Mark the approved design**

Change the design status from `Proposed` to `Approved` and record the approval date as `2026-09-22`.

- [ ] **Step 4: Commit and tag**

```bash
git add tasks.md CURRENT_STATE.md docs/superpowers/specs/2026-09-22-first-release-fast-track-design.md
git commit -m "docs: activate first-release fast track"
git tag -a cp-02-flight-engine -m "CP-02 flight acquisition and status engine"
```

Expected: the branch and annotated tag point to the verified CP-02 checkpoint commit.

---

### Task 2: Implement Pure Daily Statistics Aggregation (T-011)

**Files:**

- Create: `packages/domain/src/statistics-types.ts`
- Create: `packages/domain/src/daily-statistics.ts`
- Create: `packages/domain/src/daily-statistics.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Consumes: `OperationalStatus`, `PerformanceStatus`, service date, direction, and `delayMinutes` from persisted flight instances.
- Produces: `aggregateDailyStatistics(input: DailyStatisticsInput): DailyStatisticsResult`.

- [ ] **Step 1: Write failing fixed-dataset and zero-denominator tests**

```ts
it('excludes pending flights from punctuality while retaining cancellations in total', () => {
  const result = aggregateDailyStatistics({
    serviceDate: '2026-09-22',
    cutoffAt: new Date('2026-09-22T15:30:00.000Z'),
    flights: [
      flight('DEPARTURE', 'ON_TIME', 'SCHEDULED', 0),
      flight('ARRIVAL', 'DELAYED', 'ARRIVED', 30),
      flight('DEPARTURE', 'PENDING', 'CANCELLED', null),
    ],
  });

  expect(result).toMatchObject({
    totalFlights: 3,
    determinedFlights: 2,
    pendingFlights: 1,
    cancelledFlights: 1,
    onTimeRate: 0.5,
    cancellationRate: 1 / 3,
    averageDelayMinutes: 15,
  });
});

it('returns null rates when no denominator exists', () => {
  const result = aggregateDailyStatistics({
    serviceDate: '2026-09-22',
    cutoffAt: new Date('2026-09-22T15:30:00.000Z'),
    flights: [],
  });
  expect(result.cancellationRate).toBeNull();
  expect(result.onTimeRate).toBeNull();
  expect(result.averageDelayMinutes).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @flightcheck/domain test -- daily-statistics.test.ts`

Expected: FAIL because `aggregateDailyStatistics` does not exist.

- [ ] **Step 3: Implement literal aggregation rules**

```ts
export function aggregateDailyStatistics(
  input: DailyStatisticsInput,
): DailyStatisticsResult {
  const determined = input.flights.filter(
    (flight) =>
      flight.performanceStatus !== 'PENDING' &&
      flight.performanceStatus !== 'UNKNOWN',
  );
  const delayed = determined.filter(
    (flight) => flight.performanceStatus === 'DELAYED',
  );
  const severe = determined.filter(
    (flight) => flight.performanceStatus === 'SEVERE_DELAY',
  );
  const delays = determined
    .map((flight) => flight.delayMinutes)
    .filter((value): value is number => value !== null);

  return {
    serviceDate: input.serviceDate,
    cutoffAt: input.cutoffAt,
    totalFlights: input.flights.length,
    departureFlights: input.flights.filter(
      (flight) => flight.direction === 'DEPARTURE',
    ).length,
    arrivalFlights: input.flights.filter(
      (flight) => flight.direction === 'ARRIVAL',
    ).length,
    determinedFlights: determined.length,
    pendingFlights: input.flights.length - determined.length,
    onTimeFlights: determined.filter(
      (flight) => flight.performanceStatus === 'ON_TIME',
    ).length,
    delayedFlights: delayed.length,
    severeDelayedFlights: severe.length,
    cancelledFlights: input.flights.filter(
      (flight) => flight.operationalStatus === 'CANCELLED',
    ).length,
    unknownFlights: input.flights.filter(
      (flight) => flight.operationalStatus === 'UNKNOWN',
    ).length,
    cancellationRate:
      input.flights.length === 0
        ? null
        : input.flights.filter(
            (flight) => flight.operationalStatus === 'CANCELLED',
          ).length / input.flights.length,
    onTimeRate:
      determined.length === 0
        ? null
        : determined.filter((flight) => flight.performanceStatus === 'ON_TIME')
            .length / determined.length,
    averageDelayMinutes:
      delays.length === 0
        ? null
        : delays.reduce((sum, value) => sum + value, 0) / delays.length,
  };
}
```

- [ ] **Step 4: Run domain and repository verification**

Run: `pnpm --filter @flightcheck/domain test && pnpm --filter @flightcheck/domain typecheck && pnpm verify`

Expected: all commands exit 0 and the new fixed dataset matches hand-calculated values.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src
git commit -m "feat(statistics): implement daily aggregation engine"
```

---

### Task 3: Implement Data Quality Evaluation (T-012)

**Files:**

- Create: `packages/domain/src/data-quality.ts`
- Create: `packages/domain/src/data-quality.test.ts`
- Modify: `packages/domain/src/statistics-types.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Consumes: per-direction latest successful run, required warning severities, evaluation time, and daily cutoff.
- Produces: `evaluateDataQuality(input: DataQualityInput): DataQualityResult` with `quality`, `reasons`, `lastSuccessfulAt`, and warning summary.

- [ ] **Step 1: Write failing coverage-gap tests**

```ts
it.each([
  ['missing arrival', sourceState({ arrival: null })],
  ['stale departure', sourceState({ departureAgeMinutes: 16 })],
  ['critical warning', sourceState({ criticalWarnings: 1 })],
])('marks %s as DEGRADED', (_name, input) => {
  expect(evaluateDataQuality(input).quality).toBe('DEGRADED');
});

it('marks fresh complete direction evidence as COMPLETE', () => {
  expect(evaluateDataQuality(sourceState({}))).toEqual(
    expect.objectContaining({ quality: 'COMPLETE', reasons: [] }),
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @flightcheck/domain test -- data-quality.test.ts`

Expected: FAIL because the evaluator is not exported.

- [ ] **Step 3: Implement explicit reason codes**

Use `MISSING_DEPARTURES`, `MISSING_ARRIVALS`, `STALE_DEPARTURES`, `STALE_ARRIVALS`, and `CRITICAL_WARNING`. Return COMPLETE only when the reasons array is empty.

- [ ] **Step 4: Run verification**

Run: `pnpm --filter @flightcheck/domain test && pnpm verify`

Expected: quality tests and all repository tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src
git commit -m "feat(statistics): add data quality evaluation"
```

---

### Task 4: Persist and Settle Daily Statistics (T-013)

**Files:**

- Create: `packages/db/src/statistics-repository.ts`
- Create: `packages/db/tests/statistics-repository.test.ts`
- Modify: `packages/db/src/index.ts`
- Create: `apps/worker/src/statistics-service.ts`
- Create: `apps/worker/src/statistics-service.test.ts`
- Create: `apps/worker/src/statistics-scheduler.ts`
- Create: `apps/worker/src/statistics-scheduler.test.ts`
- Modify: `apps/worker/src/composition.ts`
- Modify: `apps/worker/src/runtime.ts`

**Interfaces:**

- Consumes: `aggregateDailyStatistics`, `evaluateDataQuality`, Prisma, Macau clock.
- Produces: `StatisticsService.recalculate({ serviceDate, trigger }): Promise<DailyStatisticResult>` and scheduled 23:30/00:05/hourly settlement.

- [ ] **Step 1: Write failing repository upsert and FINAL-protection tests**

```ts
it('upserts the same service date without duplicating rows', async () => {
  await repository.saveDailyStatistic(preliminary);
  await repository.saveDailyStatistic(recalculated);
  expect(await countDailyStatistics('2026-09-22')).toBe(1);
});

it('does not downgrade FINAL through an ordinary scheduled recalculation', async () => {
  await repository.saveDailyStatistic(finalResult);
  const saved = await repository.saveDailyStatistic(preliminary);
  expect(saved.settlementStatus).toBe('FINAL');
});
```

- [ ] **Step 2: Run DB tests and verify RED**

Run: `pnpm --filter @flightcheck/db test -- statistics-repository.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement atomic read/upsert repository**

Read all instances for the exact Macau service date, read the latest completed run for each source, and upsert `DailyStatistic` by unique `serviceDate`. Preserve FINAL unless an explicit manual recalculation supplies a newer FINAL result.

- [ ] **Step 4: Write failing fake-clock workflow tests**

Pin 23:30 preliminary snapshot, 00:05 settlement start, hourly retry, and 06:00 `FINAL_WITH_WARNINGS` deadline. Assert restart reruns the same date idempotently.

- [ ] **Step 5: Implement statistics service and scheduler**

The scheduler calls only `StatisticsService.recalculate`; it contains no aggregation rules. Timer callbacks catch and log failures so later ticks continue.

- [ ] **Step 6: Run CP-03 and full verification**

Run: `pnpm --filter @flightcheck/domain test && pnpm --filter @flightcheck/db test && pnpm --filter @flightcheck/worker test && pnpm verify`

Expected: fixed calculations, settlement boundaries, idempotent upsert, and all repository gates pass.

- [ ] **Step 7: Update ledgers, commit, and checkpoint**

```bash
git add packages/db apps/worker tasks.md CURRENT_STATE.md
git commit -m "feat(statistics): add daily settlement workflow"
git tag -a cp-03-statistics -m "CP-03 statistics"
```

---

### Task 5: Add Public-Safe Read Queries (T-020)

**Files:**

- Create: `packages/db/src/flight-query-repository.ts`
- Create: `packages/db/tests/flight-query-repository.test.ts`
- Modify: `packages/db/src/index.ts`
- Create: `apps/web/src/lib/flights/query-schema.ts`
- Create: `apps/web/src/lib/flights/query-service.ts`
- Create: `apps/web/src/lib/flights/query-service.test.ts`

**Interfaces:**

- Consumes: Prisma read-only models.
- Produces: `getDailySummary`, `listFlights`, `getFlightDetails`, `listHistory`, and `listCancellations` with Zod-validated filters and public DTOs.

- [ ] **Step 1: Write failing query-boundary tests**

Cover invalid dates, page sizes above 100, large page numbers, `NX862D`, service-date boundaries, departure/arrival filters, no data, and same-number flights on different dates.

```ts
expect(() => FlightListQuerySchema.parse({ date: '2026-02-30' })).toThrow();
expect(FlightListQuerySchema.parse({ flight: 'NX862D' }).flight).toBe('NX862D');
expect(Object.keys(publicFlight)).not.toContain('warnings');
expect(Object.keys(publicFlight)).not.toContain('correlationId');
```

- [ ] **Step 2: Run web and DB tests and verify RED**

Run: `pnpm --filter @flightcheck/db test -- flight-query-repository.test.ts && pnpm --filter @flightcheck/web test -- query-service.test.ts`

Expected: FAIL because query interfaces are absent.

- [ ] **Step 3: Implement deterministic pagination and DTO mapping**

Use `(scheduledAt, id)` as stable ordering, clamp page size to 100, return `items`, `page`, `pageSize`, `total`, and include `dataQuality` plus `lastUpdatedAt` on summary responses.

- [ ] **Step 4: Run verification and commit**

Run: `pnpm --filter @flightcheck/db test && pnpm --filter @flightcheck/web test && pnpm verify`

```bash
git add packages/db/src packages/db/tests apps/web/src/lib/flights
git commit -m "feat(api): add flight and statistics queries"
```

---

### Task 6: Build the Public First-Release UI (T-021/T-022/Public T-026)

**Files:**

- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/stat-card.tsx`
- Create: `apps/web/src/components/data-quality-banner.tsx`
- Create: `apps/web/src/components/flight-table.tsx`
- Create: `apps/web/src/app/flights/[flight]/page.tsx`
- Create: `apps/web/src/app/history/page.tsx`
- Create: `apps/web/src/app/cancellations/page.tsx`
- Create: `apps/web/src/app/public-pages.test.tsx`
- Modify: `tests/e2e/foundation.spec.ts`

**Interfaces:**

- Consumes: public DTOs from `apps/web/src/lib/flights/query-service.ts`.
- Produces: server-rendered public dashboard, detail, history, and cancellation routes.

- [ ] **Step 1: Write failing complete/degraded/empty render tests**

```tsx
render(
  await HomePage({ searchParams: Promise.resolve({ date: '2026-09-22' }) }),
);
expect(screen.getByText('總航班')).toBeVisible();
expect(screen.getByText('資料不完整')).toBeVisible();
expect(screen.getByText('N/A')).toBeVisible();
```

Also assert a flight link safely encodes `NX862D`, missing details render a 404, and identical flight numbers remain separated by date and direction.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @flightcheck/web test -- public-pages.test.tsx`

Expected: FAIL because the public components and routes are absent.

- [ ] **Step 3: Implement accessible server-rendered pages**

Use semantic headings, actual links and buttons, visible focus styles, text plus color for status, horizontal table overflow on small screens, and shared empty/error/quality patterns. Display total flights, cancellations, cancellation rate first, followed by punctuality, average delay, freshness, and quality.

- [ ] **Step 4: Add Playwright public-route smoke coverage**

Test 375×812 and 1440×900 viewports, public access without authentication, keyboard navigation, and no horizontal page overflow.

- [ ] **Step 5: Run verification and commit**

Run: `pnpm --filter @flightcheck/web test && pnpm --filter @flightcheck/web build && pnpm verify`

```bash
git add apps/web tests/e2e
git commit -m "feat(web): ship public flight dashboard and history"
```

---

### Task 7: Add Minimum Admin Operations (Launch Slices of T-023/T-024)

**Files:**

- Modify: `apps/web/src/app/admin/page.tsx`
- Create: `apps/web/src/app/admin/flights/page.tsx`
- Create: `apps/web/src/app/admin/scrape-runs/page.tsx`
- Create: `apps/web/src/app/admin/statistics/page.tsx`
- Create: `apps/web/src/app/api/admin/sync/route.ts`
- Create: `apps/web/src/app/api/admin/sync/route.test.ts`
- Create: `apps/web/src/app/api/admin/statistics/recalculate/route.ts`
- Create: `apps/web/src/app/api/admin/statistics/recalculate/route.test.ts`
- Create: `apps/web/src/lib/admin/operations.ts`
- Create: `apps/web/src/lib/admin/operations.test.ts`

**Interfaces:**

- Consumes: existing Admin session guard, FlightSyncService-compatible operation client, statistics service, and Admin audit repository.
- Produces: protected dashboard/search/health pages plus same-origin manual sync and confirmed recalculation routes.

- [ ] **Step 1: Write failing authorization, origin, audit, and overlap tests**

Assert unauthenticated requests return 401, cross-origin mutations return 403, successful actions write an audit row, manual sync returns `SKIPPED_LOCKED` when scheduled work owns the lease, and recalculation requires `{ confirmed: true }`.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @flightcheck/web test -- operations.test.ts route.test.ts`

Expected: FAIL because operational routes are absent.

- [ ] **Step 3: Implement thin protected operations**

Reuse the existing guard and origin policy. Route handlers validate Zod input, call one operation service, map typed results to HTTP, and append an audit record containing action, target date/run, and result code but no raw token or source payload.

- [ ] **Step 4: Implement Admin views**

Show latest sync per direction, incomplete/failed runs, warning counts, heartbeat freshness, flight search/details, daily statistics, and a two-step recalculation confirmation. Do not add social/settings UI.

- [ ] **Step 5: Run verification and commit**

Run: `pnpm --filter @flightcheck/web test && pnpm --filter @flightcheck/web build && pnpm verify`

```bash
git add apps/web/src/app/admin apps/web/src/app/api/admin apps/web/src/lib/admin
git commit -m "feat(admin): add launch-critical flight operations"
```

---

### Task 8: Add Startup Recovery, Heartbeat, and Backup/Restore (Launch T-027/T-028)

**Files:**

- Create: `apps/worker/src/recovery.ts`
- Create: `apps/worker/src/recovery.test.ts`
- Create: `apps/worker/src/heartbeat.ts`
- Create: `apps/worker/src/heartbeat.test.ts`
- Modify: `apps/worker/src/composition.ts`
- Modify: `apps/worker/src/runtime.ts`
- Create: `scripts/backup.sh`
- Create: `scripts/restore.sh`
- Create: `tests/ops/backup-restore.sh`
- Create: `docs/operations/backup-restore.md`

**Interfaces:**

- Consumes: JobLock repository, FlightSyncService, StatisticsService, Prisma, `pg_dump`, and `pg_restore`.
- Produces: idempotent `runStartupRecovery`, persisted/logged heartbeat, timestamped custom-format backups, and guarded restore.

- [ ] **Step 1: Write failing recovery tests**

Assert expired locks are cleared, startup performs one immediate sync, yesterday's non-FINAL statistic is recalculated, a second recovery run is idempotent, and a failure in one action does not suppress later safe actions.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @flightcheck/worker test -- recovery.test.ts heartbeat.test.ts`

Expected: FAIL because recovery and heartbeat do not exist.

- [ ] **Step 3: Implement ordered recovery and heartbeat**

Run cleanup → immediate flight sync → incomplete-statistics recovery → scheduler start. Emit heartbeat at startup and every minute with UTC timestamp and job health; never include credentials or raw source data.

- [ ] **Step 4: Write executable backup/restore verification**

`backup.sh` requires `DATABASE_URL` and an explicit output directory, writes `flightcheck-YYYYMMDDTHHMMSSZ.dump`, and checks `pg_restore --list`. `restore.sh` requires a dump path plus `CONFIRM_RESTORE=flightcheck`, restores into the supplied target database, and refuses production-looking targets unless confirmation matches.

- [ ] **Step 5: Run a clean restore drill**

Run: `bash tests/ops/backup-restore.sh`

Expected: seed source database, create backup, restore into an empty test database, and compare counts for `Flight`, `FlightInstance`, `ScrapeRun`, and `DailyStatistic`.

- [ ] **Step 6: Run verification and commit**

Run: `pnpm --filter @flightcheck/worker test && pnpm verify && bash tests/ops/backup-restore.sh`

```bash
git add apps/worker scripts tests/ops docs/operations
git commit -m "feat(ops): add startup recovery and database recovery"
```

---

### Task 9: Package Docker Production Deployment (Fast-Track T-031)

**Files:**

- Create: `apps/web/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `compose.yaml`
- Create: `.dockerignore`
- Create: `scripts/migrate.sh`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/rollback.md`
- Modify: `.env.example`

**Interfaces:**

- Consumes: built Web/Worker artifacts, PostgreSQL, migrations, health endpoints, and persistent volumes.
- Produces: independently deployable Web and Worker images plus one production Compose topology.

- [ ] **Step 1: Write failing Compose configuration checks**

Create a shell test that runs `docker compose config`, rejects secrets embedded in YAML, asserts Web and Worker have independent services/restart policies, PostgreSQL has a named volume, and migration runs before application startup.

- [ ] **Step 2: Run the check and verify RED**

Run: `bash tests/ops/compose-config.sh`

Expected: FAIL because `compose.yaml` and Dockerfiles do not exist.

- [ ] **Step 3: Implement multi-stage images and Compose services**

Use immutable Node 22 images, non-root runtime users, production-only artifacts, health checks, `restart: unless-stopped`, an internal database network, and environment-file secrets. Keep Web and Worker separately rebuildable.

- [ ] **Step 4: Document migration, TLS boundary, volumes, and rollback**

The deployment runbook must provide exact commands for first install, migration, Admin creation, health checks, backup before upgrade, separate Web/Worker upgrade, and image rollback without reversing database migrations.

- [ ] **Step 5: Verify and commit**

Run: `docker compose config && docker compose build && bash tests/ops/compose-config.sh`

```bash
git add apps/web/Dockerfile apps/worker/Dockerfile compose.yaml .dockerignore scripts/migrate.sh tests/ops/compose-config.sh docs/operations .env.example
git commit -m "ops: add first-release docker deployment"
```

---

### Task 10: Production Smoke Gate and First Release

**Files:**

- Create: `tests/smoke/production-smoke.ts`
- Create: `docs/operations/first-release-checklist.md`
- Create: `docs/releases/first-release-v0.1.0.md`
- Modify: `tasks.md`
- Modify: `CURRENT_STATE.md`

**Interfaces:**

- Consumes: deployed Web, Worker, PostgreSQL, Admin credentials, and real Macau Airport public source.
- Produces: repeatable release evidence and `first-release-v0.1.0` tag.

- [ ] **Step 1: Implement smoke assertions**

The script must verify public health, Worker heartbeat freshness, public homepage without login, Admin rejection without a session, authenticated Admin access, one real-source manual sync, visible NX flights, matching summary totals, DEGRADED display when one direction is unavailable, and no SocialEvent/SocialPost creation.

- [ ] **Step 2: Run the complete local release gate**

Run: `pnpm verify && docker compose up -d --build && pnpm tsx tests/smoke/production-smoke.ts`

Expected: all checks pass with no social publishing and no skipped critical assertion.

- [ ] **Step 3: Run migration and restore evidence on a clean database**

Run: `bash tests/ops/backup-restore.sh`

Expected: migration, seed, backup, restore, and row-count comparison pass.

- [ ] **Step 4: Deploy and run the production smoke gate**

Run the same smoke script with production base URL and production-safe Admin credentials. Do not create a synthetic cancellation or social event.

- [ ] **Step 5: Update release evidence**

Record commit SHA, CI URL, deployment timestamp, migration result, backup path, restore-drill evidence, smoke output, known deferred work, and rollback image references in the release document and `CURRENT_STATE.md`.

- [ ] **Step 6: Commit and tag**

```bash
git add tests/smoke docs/operations/first-release-checklist.md docs/releases/first-release-v0.1.0.md tasks.md CURRENT_STATE.md
git commit -m "docs: complete first public release handoff"
git tag -a first-release-v0.1.0 -m "FlightCheck first public release"
```

Expected: CI is green, production smoke evidence is recorded, the tag targets the verified release commit, and deferred SNS/full-Admin work remains open in the original backlog.

---

## Milestone Gates

| Milestone                 | Tasks | Exit evidence                                                                              |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| FR-01 Truthful statistics | 1–4   | CP-02 tagged; CP-03 calculations, quality, settlement, and fake-clock boundaries pass      |
| FR-02 Public product      | 5–6   | Public query boundary and four responsive public routes pass complete/degraded/empty tests |
| FR-03 Minimum operations  | 7–8   | Admin can inspect and trigger safely; restart recovery and backup/restore drill pass       |
| FR-04 Deploy and release  | 9–10  | Compose build, migration, production smoke, CI, and release evidence pass                  |

## Deferred Work After First Release

Resume T-014 through T-019 for SNS, complete the deferred portions of T-023 through T-030, run the full A01–H10 acceptance suite and 24-hour soak, then create the reserved `p0-v1.2.0` tag. None of these items may be marked complete merely because `first-release-v0.1.0` shipped.

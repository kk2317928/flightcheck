# Flight Sync Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the resilient T-010 flight synchronization use case, directional source-health persistence, global lease, manual CLI, and five-minute Worker loop.

**Architecture:** `apps/worker` owns a port-driven `FlightSyncService`; `@flightcheck/db` adds focused lock/run/status-read repositories while the existing observation repository remains the transition writer. Departures and arrivals run independently under one global lease, and scheduled/manual entry points call the same service.

**Tech Stack:** TypeScript 5.9, Node.js 24, Vitest 3, pnpm/Turborepo, Prisma 7, PostgreSQL/PGlite.

**Spec:** `docs/superpowers/specs/2026-09-22-flight-sync-worker-design.md`

## Global Constraints

- Persist timestamps in UTC; default service dates use `Asia/Macau`.
- Fetch departures and arrivals through separate source calls and separate `ScrapeRun`s.
- A failed direction never clears or rolls back a usable direction.
- A missing row is not a status observation and never calls the status engine.
- Scheduled and manual execution must share one use case and one `flight-sync` lease.
- Reload and re-evaluate a stale status decision once; never retry a precomputed target.
- Keep `@flightcheck/domain` free of Prisma, Worker, timer, CLI, and source-client dependencies.
- Admin API/UI remains T-023; scheduler registry, heartbeat, and recovery remain T-027.
- Use TDD for every behavior and observe RED before implementation.
- T-010 ends with one implementation commit: `feat(worker): add resilient flight sync job`; review fixes, if required after publication, use focused fix commits.

## File Structure

- Create `packages/db/src/job-lock-repository.ts` — atomic lease acquire/renew/release.
- Create `packages/db/tests/job-lock-repository.test.ts` — lease ownership, expiry, and SQL integration tests.
- Create `packages/db/src/flight-sync-repository.ts` — directional ScrapeRun lifecycle and current policy-state reads.
- Create `packages/db/tests/flight-sync-repository.test.ts` — run completion, status resolution, and failures.
- Modify `packages/db/src/flight-observation-repository.ts` — return persisted instance references for explicit observations.
- Modify `packages/db/tests/flight-observation-repository.test.ts` — pin returned instance identities and replay behavior.
- Modify `packages/db/src/index.ts` — export T-010 repositories and contracts.
- Create `apps/worker/src/flight-sync.ts` — port-driven synchronization orchestration.
- Create `apps/worker/src/flight-sync.test.ts` — lock, direction isolation, CAS retry, and missing-row tests.
- Create `apps/worker/src/flight-sync.integration.test.ts` — fixture-to-database two-round workflow.
- Create `apps/worker/src/composition.ts` — production dependency wiring.
- Create `apps/worker/src/scheduler.ts` — immediate run plus five-minute interval.
- Create `apps/worker/src/scheduler.test.ts` — fake-timer scheduling and stop behavior.
- Create `apps/worker/src/cli.ts` — manual sync argument parsing and exit codes.
- Create `apps/worker/src/cli.test.ts` — date validation and result reporting.
- Modify `apps/worker/src/runtime.ts` — start the composed scheduler after environment validation.
- Modify `apps/worker/src/runtime.test.ts` — startup composition boundary.
- Modify `apps/worker/src/index.ts` — terminate scheduler cleanly on signals.
- Modify `apps/worker/package.json` — DB/domain/source dependencies and `sync` script.
- Modify `pnpm-lock.yaml` — Worker workspace dependency graph.
- Modify `packages/db/README.md` and root `README.md` — lease, run, scheduler, and CLI operations.
- Modify `tasks.md` and `CURRENT_STATE.md` — T-010 evidence and CP-02 checkpoint state.

## Review Focus

- An expired lock takeover racing the old owner must not allow the old owner to renew or release the new lease; Task 1 pins owner-qualified mutations.
- A parser-usable `PARTIAL` result with zero flights must complete as partial rather than failed or imply disappearance; Task 3 pins the distinction.
- A stale transition caused after observation persistence must reload the post-persistence timing fields and full policy state before re-evaluation; Task 3 pins the exact retry input.
- Two directions returning flights with the same flight number and scheduled instant must remain separate by direction; Task 4 pins the database identity.
- A rejected scheduler promise must be logged and must not permanently stop later five-minute ticks; Task 5 pins recovery of the timer loop.

---

### Task 1: Atomic Job Lock Repository

**Files:**

- Create: `packages/db/src/job-lock-repository.ts`
- Create: `packages/db/tests/job-lock-repository.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: generated `PrismaClient`, UTC `Date` values.
- Produces: `JobLockRepository`, `createJobLockRepository(prisma)`, and owner-qualified acquire/renew/release methods.

- [ ] **Step 1: Write failing lease contract tests**

Define these public inputs and exercise a fixed `now`:

```ts
export interface AcquireJobLockInput {
  name: string;
  ownerId: string;
  now: Date;
  leaseMs: number;
}

export interface JobLockRepository {
  acquire(input: AcquireJobLockInput): Promise<boolean>;
  renew(input: AcquireJobLockInput): Promise<boolean>;
  release(
    input: Pick<AcquireJobLockInput, 'name' | 'ownerId'>,
  ): Promise<boolean>;
}
```

Tests must prove: first owner acquires; second live owner loses; an expired
lease is taken over; the old owner cannot renew or release after takeover; the
new owner can renew/release; invalid dates and non-positive `leaseMs` reject.
Capture Prisma query events and require conflict-safe SQL containing
`ON CONFLICT` for acquisition and owner conditions for renew/release.

- [ ] **Step 2: Run tests and observe RED**

Run: `pnpm --filter @flightcheck/db test -- job-lock-repository.test.ts`

Expected: FAIL because `job-lock-repository.ts` and its exports do not exist.

- [ ] **Step 3: Implement atomic lease operations**

Use one PostgreSQL statement for acquisition:

```sql
INSERT INTO "JobLock" ("name", "ownerId", "acquiredAt", "heartbeatAt", "expiresAt")
VALUES ($1, $2, $3, $3, $4)
ON CONFLICT ("name") DO UPDATE
SET "ownerId" = EXCLUDED."ownerId",
    "acquiredAt" = EXCLUDED."acquiredAt",
    "heartbeatAt" = EXCLUDED."heartbeatAt",
    "expiresAt" = EXCLUDED."expiresAt"
WHERE "JobLock"."expiresAt" <= EXCLUDED."acquiredAt"
RETURNING "name";
```

Use `updateMany({ where: { name, ownerId }, ... })` for renew and
`deleteMany({ where: { name, ownerId } })` for release. Validate every input
before issuing SQL and wrap failures in `JobLockPersistenceError` with cause.

- [ ] **Step 4: Run DB verification**

Run: `pnpm --filter @flightcheck/db test -- job-lock-repository.test.ts && pnpm --filter @flightcheck/db typecheck`

Expected: lease tests pass and typecheck exits 0.

### Task 2: ScrapeRun Lifecycle and Status-State Reads

**Files:**

- Create: `packages/db/src/flight-sync-repository.ts`
- Create: `packages/db/tests/flight-sync-repository.test.ts`
- Modify: `packages/db/src/flight-observation-repository.ts`
- Modify: `packages/db/tests/flight-observation-repository.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: Prisma `ScrapeSource`, `ScrapeRunStatus`, normalized observations, and T-009 instance fields.
- Produces: `FlightSyncRepository`, `PersistedFlightObservation`, expanded `PersistObservationBatchResult.instances`, and `getFlightStatusState`.

- [ ] **Step 1: Write failing repository tests**

Define exact lifecycle contracts:

```ts
export interface StartScrapeRunInput {
  source: 'DEPARTURES' | 'ARRIVALS';
  correlationId: string;
  startedAt: Date;
}

export interface CompleteScrapeRunInput {
  id: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  finishedAt: Date;
  fetchedAt: Date | null;
  sourceUpdatedAt: Date | null;
  rowCount: number;
  nxFlightCount: number;
  warningCount: number;
  warnings: readonly FlightSourceWarning[];
  errorCode: string | null;
}

export interface PersistedFlightObservation {
  flightInstanceId: string;
  observation: NormalizedFlight;
}
```

Test run creation as `RUNNING`, all completion fields, rejecting completion of
a missing/already-finished run, and loading exactly these fields:

```ts
{
  operationalStatus,
  performanceStatus,
  delayMinutes,
  scheduleVarianceMinutes,
  cancelledObservedCount,
  cancelConfirmedAt,
  lastStatusObservedAt,
}
```

Extend observation tests so `persistObservationBatch` returns one
`PersistedFlightObservation` per explicit input, including the correct
direction-specific instance ID even when a snapshot is unchanged.

- [ ] **Step 2: Run tests and observe RED**

Run: `pnpm --filter @flightcheck/db test -- flight-sync-repository.test.ts flight-observation-repository.test.ts`

Expected: FAIL because lifecycle/state methods and `instances` are missing.

- [ ] **Step 3: Implement focused DB repositories**

`FlightSyncRepository` must expose:

```ts
startScrapeRun(input: StartScrapeRunInput): Promise<{ id: string }>;
completeScrapeRun(input: CompleteScrapeRunInput): Promise<void>;
getFlightStatusState(flightInstanceId: string): Promise<{
  operationalStatus: OperationalStatus;
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
  scheduleVarianceMinutes: number | null;
  cancelledObservedCount: number;
  cancelConfirmedAt: Date | null;
  lastStatusObservedAt: Date | null;
}>;
```

Complete runs with `updateMany({ where: { id, status: 'RUNNING' } })` and throw
when the affected count is not one. In observation persistence, collect the
selected instance ID beside the parsed observation and return it after the
transaction; do not re-query by flight number alone.

- [ ] **Step 4: Run DB package verification**

Run: `pnpm --filter @flightcheck/db test && pnpm --filter @flightcheck/db typecheck && pnpm --filter @flightcheck/db build`

Expected: all DB tests, generated client, typecheck, and build pass.

### Task 3: Port-Driven Flight Sync Service

**Files:**

- Create: `apps/worker/src/flight-sync.ts`
- Create: `apps/worker/src/flight-sync.test.ts`
- Modify: `apps/worker/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `FlightSourceAdapter`, `FlightObservationRepository`, `FlightSyncRepository`, `JobLockRepository`, `applyFlightStatusObservation`, logger, and clock.
- Produces: `createFlightSyncService(dependencies)` and `run(input): Promise<FlightSyncResult>`.

- [ ] **Step 1: Add dependencies and write failing service tests**

Add workspace dependencies on `@flightcheck/db`, `@flightcheck/domain`, and
`@flightcheck/flight-source`. Define:

```ts
export type FlightSyncOverallStatus =
  'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED_LOCKED';

export interface FlightSyncInput {
  serviceDate: string;
  trigger: 'SCHEDULED' | 'MANUAL' | 'STARTUP';
}

export interface DirectionSyncResult {
  direction: 'DEPARTURE' | 'ARRIVAL';
  scrapeRunId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  processedFlights: number;
  errorCode: string | null;
}
```

With fake ports, test: lock loss returns `SKIPPED_LOCKED` and makes no source
calls; both directions are requested separately and concurrently; one failed
direction plus one success returns `PARTIAL`; both failed returns `FAILED`;
usable partial with zero flights completes `PARTIAL`; failed results never call
persistence/status; only explicit persisted instances call the engine; release
runs in `finally`.

Add the Review Focus stale test: first writer call rejects with a cause whose
message is `Stale status transition`; assert the service reloads state after
persistence, invokes `applyFlightStatusObservation` with the reloaded timing and
policy fields, and succeeds on the second evaluation. A second stale rejection
must finish that direction `FAILED` with `STATUS_CONFLICT`.

- [ ] **Step 2: Run tests and observe RED**

Run: `pnpm --filter @flightcheck/worker test -- flight-sync.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement orchestration with isolated directions**

Use constants:

```ts
const LOCK_NAME = 'flight-sync';
const LEASE_MS = 90_000;
const DIRECTIONS = [
  { direction: 'DEPARTURE', source: 'DEPARTURES' },
  { direction: 'ARRIVAL', source: 'ARRIVALS' },
] as const;
```

Create both running ScrapeRuns after lock acquisition, then call
`Promise.all(DIRECTIONS.map(runDirection))`. Each direction catches and records
its own source/processing failure. Compute overall status from the two settled
direction results. In status application, identify staleness by traversing
`Error.cause` safely; reload and call the domain service once more, never reuse
the first transition input.

- [ ] **Step 4: Run Worker unit verification**

Run: `pnpm --filter @flightcheck/worker test -- flight-sync.test.ts && pnpm --filter @flightcheck/worker typecheck`

Expected: all orchestration cases pass and typecheck exits 0.

### Task 4: Production Composition and Fixture Integration

**Files:**

- Create: `apps/worker/src/composition.ts`
- Create: `apps/worker/src/flight-sync.integration.test.ts`
- Modify: `packages/flight-source/src/macau-airport-adapter.ts` only if an injectable fixture client gap is proven by the test.

**Interfaces:**

- Consumes: real repository factories, Macau Airport adapter/client, Prisma client, shared logger/clock.
- Produces: `createWorkerServices(environment, options?)` returning `{ prisma, flightSyncService }`.

- [ ] **Step 1: Write failing database-backed fixture test**

Build the source from sanitized fixture documents and embedded PostgreSQL. Run
two explicit sync rounds with increasing `observedAt` values where the same NX
flight is cancelled. Assert:

- one departure and one arrival ScrapeRun per round;
- cancellation advances `CANCEL_PENDING -> CANCELLED`;
- repeated identical payload creates no second snapshot;
- replaying the same `observedAt` does not advance cancellation;
- arrival and departure with equal flight number/scheduled instant have distinct
  instance IDs;
- departure success plus arrival source failure preserves departure rows and
  returns overall `PARTIAL`.

- [ ] **Step 2: Run integration test and observe RED**

Run: `pnpm --filter @flightcheck/worker test -- flight-sync.integration.test.ts`

Expected: FAIL because production composition is missing.

- [ ] **Step 3: Implement production wiring**

Create one Prisma client and pass structural repositories to the Worker service.
Instantiate `MacauAirportHttpClient` and `MacauAirportFlightSource`; keep test
options limited to `source`, `now`, `logger`, and owner-ID generation. Do not
add a second orchestration path for fixtures.

- [ ] **Step 4: Run Worker and DB verification**

Run: `pnpm --filter @flightcheck/worker test && pnpm --filter @flightcheck/worker typecheck && pnpm --filter @flightcheck/worker build && pnpm --filter @flightcheck/db test`

Expected: all Worker unit/integration and DB tests pass.

### Task 5: Manual CLI and Five-Minute Scheduler

**Files:**

- Create: `apps/worker/src/cli.ts`
- Create: `apps/worker/src/cli.test.ts`
- Create: `apps/worker/src/scheduler.ts`
- Create: `apps/worker/src/scheduler.test.ts`
- Modify: `apps/worker/src/runtime.ts`
- Modify: `apps/worker/src/runtime.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/package.json`

**Interfaces:**

- Consumes: composed `FlightSyncService`, `getMacauDateKey`, clock/timer/logger ports.
- Produces: `runFlightSyncCli`, `startFlightSyncScheduler`, and a stoppable Worker runtime.

- [ ] **Step 1: Write failing CLI and scheduler tests**

CLI cases:

```ts
await runFlightSyncCli(['--date', '2026-09-22'], dependencies);
await runFlightSyncCli([], { ...dependencies, now: () => macauInstant });
```

Assert strict calendar validation, rejection of missing/unknown arguments,
`MANUAL` trigger, JSON-safe output, exit `1` only for `FAILED`, and cleanup of
Prisma in `finally`.

Scheduler cases with fake timers: immediate `STARTUP` call; `SCHEDULED` calls at
300,000 ms; `stop()` prevents future calls; a rejected run is logged and the
next tick still executes. Runtime tests assert environment validation happens
before composition and that signal handlers stop scheduling without starting a
new job.

- [ ] **Step 2: Run tests and observe RED**

Run: `pnpm --filter @flightcheck/worker test -- cli.test.ts scheduler.test.ts runtime.test.ts`

Expected: FAIL because CLI/scheduler interfaces are missing.

- [ ] **Step 3: Implement CLI, scheduler, and runtime entry points**

Use `startOfMacauDateUtc` for strict validation and `getMacauDateKey(now())` for
the default. Add:

```json
{
  "scripts": {
    "sync": "tsx --env-file=../../.env src/cli.ts"
  }
}
```

The scheduler retains its interval handle, catches each run promise to log a
stable `flight-sync.failed` event, and exposes `stop(): void`. Keep process exit
and signal side effects in entry-point functions so unit imports remain safe.

- [ ] **Step 4: Run Worker verification**

Run: `pnpm --filter @flightcheck/worker lint && pnpm --filter @flightcheck/worker typecheck && pnpm --filter @flightcheck/worker test && pnpm --filter @flightcheck/worker build`

Expected: all Worker checks pass with fake timers and no live network access.

### Task 6: Documentation, T-010 Checkpoint, and Full Verification

**Files:**

- Modify: `packages/db/README.md`
- Modify: `README.md`
- Modify: `tasks.md`
- Modify: `CURRENT_STATE.md`

**Interfaces:**

- Consumes: verified behavior and exact test output from Tasks 1-5.
- Produces: durable T-010 handoff and CP-02 verification evidence.

- [ ] **Step 1: Update operational documentation**

Document `pnpm --filter @flightcheck/worker sync [--date YYYY-MM-DD]`, the
five-minute/startup behavior, lock lease semantics, `SUCCESS/PARTIAL/FAILED`,
directional ScrapeRuns, and the rule that missing rows do not imply
cancellation. State that T-023 owns the protected Admin trigger and T-027 owns
advanced recovery.

- [ ] **Step 2: Run CP-02 acceptance-focused tests**

Run:

```bash
pnpm --filter @flightcheck/flight-source test
pnpm --filter @flightcheck/domain test
pnpm --filter @flightcheck/db test
pnpm --filter @flightcheck/worker test
```

Expected: all A01-A12/B01-B12-relevant package tests pass, including two-round
cancellation, partial source, lock overlap, and idempotent replay.

- [ ] **Step 3: Update checkpoint state**

Mark T-010 `[x]` only after Step 2 passes. Update `CURRENT_STATE.md` with exact
test totals, commands, durable decisions, remaining PGlite concurrency risk, and
T-011 as the next action. Mark CP-02 gate items complete only where automated
evidence exists; do not create the checkpoint tag before the full gate review.

- [ ] **Step 4: Run fresh repository-wide verification**

Run:

```bash
TURBO_FORCE=true TZ=Asia/Macau \
DATABASE_URL=postgresql://flightcheck:flightcheck@127.0.0.1:5432/flightcheck \
pnpm verify
```

Expected: format, lint, typecheck, all tests, and production builds pass for
every workspace with no skipped T-010 critical case.

- [ ] **Step 5: Create the single implementation commit**

Stage only T-010 source, tests, docs, package manifests, and lockfile. Exclude
generated Prisma client, `dist`, `.next`, `node_modules`, `.turbo`, local SDD
ledger, and `FlightCheck_IMPLEMENTATION_TASKS_CHECKPOINTS.md`.

```bash
git add apps/worker packages/db/src packages/db/tests packages/db/README.md \
  packages/db/src/index.ts README.md pnpm-lock.yaml tasks.md CURRENT_STATE.md
git commit -m "feat(worker): add resilient flight sync job"
```

- [ ] **Step 6: Prepare whole-branch review**

Review the range from design/plan checkpoints through the implementation
commit. Check all five Review Focus cases, lock takeover safety, directional
isolation, ScrapeRun truthfulness, missing-row behavior, stale recomputation,
fixture idempotency, scheduler resilience, and CLI cleanup. Fix all
Critical/Important findings with RED->GREEN evidence, rerun `pnpm verify`, and
record deferred Minor findings before branch integration.

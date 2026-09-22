# Flight Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist normalized Air Macau observations as idempotent flight instances and material snapshots, persist scrape warnings atomically, and record only real status transitions.

**Architecture:** `@flightcheck/db` owns a focused `FlightObservationRepository` backed by one interactive Prisma transaction per operation. A pure canonicalizer produces deterministic JSON and SHA-256 hashes; PostgreSQL unique constraints and conditional updates provide replay and concurrency safety. The repository consumes `NormalizedFlight` and `FlightSourceWarning` from `@flightcheck/flight-source`, but does not derive status policy.

**Tech Stack:** TypeScript 5.9, Prisma 7.10, PostgreSQL/PGlite, Vitest 3, Node.js SHA-256

**Spec:** `docs/superpowers/specs/2026-09-22-flight-persistence-design.md`

## Global Constraints

- Work only on `feat/t-008-flight-persistence`; do not implement T-009 status derivation or T-010 orchestration.
- Store timestamps in UTC and represent `serviceDate` as the PostgreSQL date corresponding to the normalized `YYYY-MM-DD` value.
- Preserve flight numbers as strings, including suffixes such as `NX862D`.
- Keep operational status separate from performance status.
- Observation persistence must not mutate T-009-owned status, delay, cancellation-count, or cancellation-confirmation fields.
- A snapshot hash excludes observation time and scrape-run metadata.
- Each repository operation is atomic; failures return no partial success.
- Follow the repository rule of one focused T-008 commit: `feat(flights): persist instances snapshots and history`.

## Review Focus

- A metadata-only replay with a different `observedAt`/`scrapeRunId` must reuse the existing snapshot while still advancing `lastObservedAt`.
- Two observations that differ only by direction must create distinct instances and directional schedule fields.
- A failure late in a multi-flight batch must roll back earlier flight, instance, snapshot, and warning writes.
- Concurrent identical snapshot writes must resolve through the database constraint without leaking a uniqueness error or over-counting inserts.
- Concurrent identical status transitions must create no more than one history row and must not overwrite a newer state.

---

## File Structure

- Create `packages/db/src/flight-snapshot.ts`: canonical payload type, deterministic canonicalization, and SHA-256 hashing only.
- Create `packages/db/src/flight-observation-repository.ts`: repository contracts and Prisma implementation for observation batches and status transitions.
- Create `packages/db/src/flight-snapshot.test.ts`: pure canonicalization/hash unit tests.
- Create `packages/db/tests/flight-observation-repository.test.ts`: PGlite-backed transaction, replay, direction, warnings, rollback, and transition integration tests.
- Create `packages/db/prisma/migrations/20260922000200_status_history_previous_values/migration.sql`: add previous-value columns required by the approved transition-history design.
- Modify `packages/db/prisma/schema.prisma`: expose nullable previous operational/performance/delay fields on `FlightStatusHistory`.
- Modify `packages/db/src/index.ts`: export the repository, canonicalizer, and public contracts.
- Modify `packages/db/package.json` and `pnpm-lock.yaml`: add the workspace dependency on `@flightcheck/flight-source`.
- Modify `packages/db/tests/schema-contract.test.ts`: pin the status-history previous-value columns.
- Modify `packages/db/tests/migration.test.ts`: apply all migration directories in filename order and verify the additive history migration.
- Modify `tasks.md` and `CURRENT_STATE.md`: mark T-008 active before implementation and verified only after all gates pass.

### Task 1: Canonical Snapshot Contract

**Files:**

- Create: `packages/db/src/flight-snapshot.test.ts`
- Create: `packages/db/src/flight-snapshot.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: `NormalizedFlight` from `@flightcheck/flight-source`.
- Produces: `CanonicalFlightSnapshot`, `buildCanonicalFlightSnapshot(flight)`, and `hashCanonicalFlightSnapshot(payload)`.

- [ ] **Step 1: Mark T-008 active before production changes**

Change `tasks.md` from `- [ ] T-008` to `- [-] T-008`. Update `CURRENT_STATE.md` branch to `feat/t-008-flight-persistence`, set T-008 active, and set the next action to the first failing canonicalization test.

- [ ] **Step 2: Add the flight-source workspace dependency**

Add this runtime dependency to `packages/db/package.json`, then refresh the lockfile:

```json
"@flightcheck/flight-source": "workspace:*"
```

Run: `pnpm install --lockfile-only`
Expected: exit 0 and `packages/db` imports `@flightcheck/flight-source` in `pnpm-lock.yaml`.

- [ ] **Step 3: Write failing canonicalization tests**

Create `packages/db/src/flight-snapshot.test.ts` with a fixed `NormalizedFlight` fixture and assertions that:

```ts
const first = buildCanonicalFlightSnapshot(flight);
const replay = buildCanonicalFlightSnapshot({ ...flight });

expect(first).toEqual({
  flightNumber: 'NX001',
  serviceDate: '2026-09-22',
  direction: 'DEPARTURE',
  scheduledAt: '2026-09-22T08:00:00.000Z',
  estimatedAt: null,
  actualAt: null,
  origin: { code: 'MFM', name: 'Macau' },
  destination: { code: 'TPE', name: 'Taipei' },
  sourceStatus: 'SCHEDULED',
  rawStatus: 'Scheduled',
});
expect(hashCanonicalFlightSnapshot(first)).toMatch(/^[a-f0-9]{64}$/);
expect(hashCanonicalFlightSnapshot(first)).toBe(
  hashCanonicalFlightSnapshot(replay),
);
```

Add a second test proving a changed `estimatedAt`, airport name, source status, or raw status changes the hash. The test name must identify `hashCanonicalFlightSnapshot` as the production behavior that would break.

- [ ] **Step 4: Run the unit test and verify RED**

Run: `pnpm --filter @flightcheck/db exec vitest run src/flight-snapshot.test.ts`
Expected: FAIL because `./flight-snapshot.js` does not exist.

- [ ] **Step 5: Implement deterministic snapshot construction and hashing**

Create `packages/db/src/flight-snapshot.ts` with an explicit field-order payload:

```ts
import { createHash } from 'node:crypto';
import type { NormalizedFlight } from '@flightcheck/flight-source';

export interface CanonicalFlightSnapshot {
  flightNumber: string;
  serviceDate: string;
  direction: NormalizedFlight['direction'];
  scheduledAt: string;
  estimatedAt: string | null;
  actualAt: string | null;
  origin: { code: string | null; name: string };
  destination: { code: string | null; name: string };
  sourceStatus: NormalizedFlight['sourceStatus'];
  rawStatus: string;
}

export function buildCanonicalFlightSnapshot(
  flight: NormalizedFlight,
): CanonicalFlightSnapshot {
  return {
    flightNumber: flight.flightNumber,
    serviceDate: flight.serviceDate,
    direction: flight.direction,
    scheduledAt: flight.scheduledAt.toISOString(),
    estimatedAt: flight.estimatedAt?.toISOString() ?? null,
    actualAt: flight.actualAt?.toISOString() ?? null,
    origin: { code: flight.origin.code, name: flight.origin.name },
    destination: {
      code: flight.destination.code,
      name: flight.destination.name,
    },
    sourceStatus: flight.sourceStatus,
    rawStatus: flight.rawStatus,
  };
}

export function hashCanonicalFlightSnapshot(
  payload: CanonicalFlightSnapshot,
): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
```

Export these functions and the type from `packages/db/src/index.ts`.

- [ ] **Step 6: Run the unit test and verify GREEN**

Run: `pnpm --filter @flightcheck/db exec vitest run src/flight-snapshot.test.ts`
Expected: PASS with 2 tests and no warnings.

### Task 2: Atomic Observation Persistence

**Files:**

- Create: `packages/db/tests/flight-observation-repository.test.ts`
- Create: `packages/db/src/flight-observation-repository.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: `buildCanonicalFlightSnapshot`, `hashCanonicalFlightSnapshot`, `PrismaClient`, `NormalizedFlight[]`, `FlightSourceWarning[]`.
- Produces: `createFlightObservationRepository(prisma)`, `persistObservationBatch(input)`, and `PersistObservationBatchResult`.

- [ ] **Step 1: Write failing integration tests for first persistence and replay**

Use the existing PGlite socket pattern from `packages/db/tests/seed-integration.test.ts`, on a distinct port, apply every migration in filename order, and create a `ScrapeRun`. Assert that the first call:

```ts
await expect(
  repository.persistObservationBatch({
    scrapeRunId,
    observedAt: new Date('2026-09-22T08:05:00.000Z'),
    flights: [departure],
    warnings: [],
  }),
).resolves.toEqual({
  processedInstances: 1,
  insertedSnapshots: 1,
  unchangedSnapshots: 0,
  persistedWarnings: 0,
});
```

Then replay the same material observation with a later `observedAt` and a second valid `ScrapeRun`; expect zero inserted snapshots, one unchanged snapshot, one total database snapshot, and the instance `lastObservedAt` advanced to the later time.

- [ ] **Step 2: Run the focused integration test and verify RED**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts -t 'persists a new observation|replays an identical material payload'`
Expected: FAIL because `createFlightObservationRepository` is not exported.

- [ ] **Step 3: Implement the observation repository contract and minimal transaction**

Define exact public inputs/results:

```ts
export interface PersistObservationBatchInput {
  scrapeRunId: string;
  observedAt: Date;
  flights: readonly NormalizedFlight[];
  warnings: readonly FlightSourceWarning[];
}

export interface PersistObservationBatchResult {
  processedInstances: number;
  insertedSnapshots: number;
  unchangedSnapshots: number;
  persistedWarnings: number;
}
```

Inside one `prisma.$transaction`, validate the `ScrapeRun` with `findUniqueOrThrow`, then for each flight:

1. upsert `Flight` by `flightNumber`;
2. parse `serviceDate` as `new Date(\`${flight.serviceDate}T00:00:00.000Z\`)`;
3. upsert `FlightInstance` by `flightId_serviceDate_direction_scheduledAt`;
4. on create/update set `estimatedAt`, `actualAt`, codes, `lastObservedAt`, and only the direction-appropriate scheduled field;
5. insert the canonical snapshot through `createMany({ data: [...], skipDuplicates: true })` and use its count for inserted/unchanged totals;
6. update `ScrapeRun.warnings` and `warningCount` before returning.

Do not write any operational/performance/delay/cancellation fields. Convert warning data to a Prisma JSON-compatible value without stringifying it.

- [ ] **Step 4: Run the focused integration tests and verify GREEN**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts -t 'persists a new observation|replays an identical material payload'`
Expected: PASS with both focused cases.

- [ ] **Step 5: Write failing tests for material changes, direction separation, and status preservation**

Add a test that changes only `estimatedAt` after an identical replay and asserts exactly one additional snapshot is inserted, followed by another replay that inserts none. Add tests that persist arrival and departure observations sharing flight number/date/scheduled instant and assert two instances with opposite directional schedule fields. Seed one existing instance with `CANCEL_PENDING`, `DELAYED`, `delayMinutes: 20`, and `cancelledObservedCount: 1`; persist a new observation and assert those four fields remain unchanged.

- [ ] **Step 6: Run the new tests and verify RED where behavior is missing**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts -t 'creates one snapshot for a material change|keeps arrival and departure|preserves status-engine fields'`
Expected: at least one assertion FAILS until the upsert field selection and identity are correct.

- [ ] **Step 7: Make direction and ownership behavior pass**

Restrict the upsert update object to the mutable fields named in the spec. For a departure set `scheduledDepartureAt`; for an arrival set `scheduledArrivalAt`; never clear or populate the opposite field during an update.

- [ ] **Step 8: Run the direction/status tests and verify GREEN**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts -t 'creates one snapshot for a material change|keeps arrival and departure|preserves status-engine fields'`
Expected: PASS.

- [ ] **Step 9: Write failing warning and rollback tests**

Persist two structured warnings and assert `ScrapeRun.warnings` equals the supplied array and `warningCount` is 2; call again with `[]` and assert replacement to `[]`/0. For rollback, submit one valid observation followed by an invalid flight number longer than the database-safe contract after bypassing the TypeScript type in the test, or inject a deterministic database failure within the test transaction boundary; assert no new `Flight`, `FlightInstance`, `FlightSnapshot`, or warning update remains. Also call with a missing run UUID and assert contextual error text includes `persist observation batch` and the original Prisma cause remains available.

- [ ] **Step 10: Run warning/rollback tests and verify RED**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts -t 'replaces scrape warnings|rolls back the whole batch|retains the database cause'`
Expected: FAIL until warning replacement, validation, rollback, and contextual errors are complete.

- [ ] **Step 11: Implement validation and contextual errors**

Validate every flight with `NormalizedFlightSchema.parse` and warning with `FlightSourceWarningSchema.parse` at the repository boundary. Add a `FlightPersistenceError extends Error` whose constructor sets `cause` and operation context. Let the interactive transaction roll back before wrapping the error outside `$transaction`.

- [ ] **Step 12: Run the entire observation integration file and verify GREEN**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts`
Expected: every observation, replay, direction, preservation, warning, and rollback case passes.

### Task 3: Race-Safe Status History

**Files:**

- Create: `packages/db/prisma/migrations/20260922000200_status_history_previous_values/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/tests/schema-contract.test.ts`
- Modify: `packages/db/tests/migration.test.ts`
- Modify: `packages/db/tests/flight-observation-repository.test.ts`
- Modify: `packages/db/src/flight-observation-repository.ts`

**Interfaces:**

- Consumes: a persisted `FlightInstance` ID and caller-calculated target status from T-009.
- Produces: `recordStatusTransition(input): Promise<{ changed: boolean }>` and history rows containing both previous and new state.

- [ ] **Step 1: Write the failing schema contract test**

Assert `FlightStatusHistory` contains:

```prisma
previousOperationalStatus OperationalStatus?
previousPerformanceStatus PerformanceStatus?
previousDelayMinutes      Int?
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/schema-contract.test.ts`
Expected: FAIL because the previous-value fields are absent.

- [ ] **Step 3: Add the additive Prisma migration**

Add the three nullable fields to `schema.prisma` and create this forward migration:

```sql
ALTER TABLE "FlightStatusHistory"
  ADD COLUMN "previousOperationalStatus" "OperationalStatus",
  ADD COLUMN "previousPerformanceStatus" "PerformanceStatus",
  ADD COLUMN "previousDelayMinutes" INTEGER;
```

Run: `pnpm --filter @flightcheck/db db:generate`
Expected: Prisma Client generation exits 0.

- [ ] **Step 4: Run schema and migration tests and verify GREEN**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/schema-contract.test.ts tests/migration.test.ts`
Expected: PASS, with the integration helper applying both migrations in filename order.

- [ ] **Step 5: Write failing unchanged/changed transition tests**

Define the public input:

```ts
export interface RecordStatusTransitionInput {
  flightInstanceId: string;
  expectedOperationalStatus: OperationalStatus;
  expectedPerformanceStatus: PerformanceStatus;
  expectedDelayMinutes: number | null;
  operationalStatus: OperationalStatus;
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
  reason: string | null;
  observedAt: Date;
}
```

For an unchanged request, expect `{ changed: false }`, no instance mutation, and zero history rows. For a changed request, expect `{ changed: true }`, the instance target state, and one history row containing prior and target values, reason, and `observedAt`.

- [ ] **Step 6: Run transition tests and verify RED**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts -t 'does not record an unchanged status|records one real status transition'`
Expected: FAIL because `recordStatusTransition` is missing.

- [ ] **Step 7: Implement expected-state compare-and-write in one transaction**

Within `prisma.$transaction`:

1. read the current instance or throw a contextual not-found error;
2. return unchanged when all three target dimensions equal current values;
3. reject as stale when current values do not match the caller's expected state;
4. call `updateMany` with `where` containing the ID and all three expected dimensions, including `null` delay handling;
5. when count is zero, re-read once: return unchanged only if the target already won, otherwise reject the stale decision;
6. when count is one, insert one history row with expected and target values and return changed.

This prevents a stale caller from overwriting a newer state without requiring database-specific advisory locks. T-009 must recompute policy after a stale rejection.

- [ ] **Step 8: Run transition tests and verify GREEN**

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts -t 'does not record an unchanged status|records one real status transition'`
Expected: PASS.

- [ ] **Step 9: Write and run the concurrent transition regression test**

Issue two identical `recordStatusTransition` promises with `Promise.all`; assert both resolve, exactly one returns `changed: true`, exactly one history row exists, and the target state is persisted.

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts -t 'deduplicates concurrent identical transitions'`
Expected before final concurrency handling: FAIL through a duplicate history row, stale update, or transient transaction error. After the bounded compare-and-write implementation is complete: PASS.

- [ ] **Step 10: Add and run concurrent snapshot replay coverage**

Create two separate scrape runs and issue identical material batch writes concurrently. Assert both resolve, the sum of `insertedSnapshots` is 1, the sum of `unchangedSnapshots` is 1, and only one snapshot exists.

Run: `pnpm --filter @flightcheck/db exec vitest run tests/flight-observation-repository.test.ts -t 'deduplicates concurrent identical snapshots'`
Expected: PASS through `createMany({ skipDuplicates: true })` and the database unique constraint.

### Task 4: Full Verification, Handoff, and Checkpoint Commit

**Files:**

- Modify: `packages/db/README.md`
- Modify: `CURRENT_STATE.md`
- Modify: `tasks.md`

**Interfaces:**

- Consumes: all T-008 repository exports and verification evidence.
- Produces: durable usage documentation, verified task ledger, and the single authoritative T-008 commit.

- [ ] **Step 1: Document repository usage and ownership boundaries**

Add a concise `packages/db/README.md` section showing `createFlightObservationRepository(prisma)`, required existing `scrapeRunId`, changed-only snapshots, warning replacement, and that T-009 supplies status decisions.

- [ ] **Step 2: Run package-level quality gates**

Run: `pnpm --filter @flightcheck/db lint && pnpm --filter @flightcheck/db typecheck && pnpm --filter @flightcheck/db test && pnpm --filter @flightcheck/db build`
Expected: all four commands exit 0; all DB tests pass with no unhandled errors.

- [ ] **Step 3: Run repository-wide verification**

Run: `TZ=Asia/Macau DATABASE_URL=postgresql://flightcheck:flightcheck@127.0.0.1:5432/flightcheck pnpm verify`
Expected: formatting, lint, typecheck, every Vitest suite, and every production build exit 0.

- [ ] **Step 4: Reconcile acceptance requirements**

Re-read the approved design and verify every acceptance row has a named passing test: identical replay, one material-change snapshot, direction separation, real-only status history, durable warnings, atomic rollback, and both concurrency cases. If a row lacks evidence, add a failing test first and repeat RED/GREEN before continuing.

- [ ] **Step 5: Update persistent handoff state**

Mark T-008 `[x]` in `tasks.md`. Update `CURRENT_STATE.md` with:

- branch `feat/t-008-flight-persistence`;
- T-008 as the latest completed task;
- exact verification commands and test counts from fresh output;
- the canonical-hash and conditional-transition decisions;
- the additive migration name;
- next action: start T-009 Status Engine.

- [ ] **Step 6: Re-run documentation-sensitive verification**

Run: `pnpm format:check && pnpm --filter @flightcheck/db typecheck && pnpm --filter @flightcheck/db test`
Expected: all commands exit 0 after state and README edits.

- [ ] **Step 7: Create the T-008 checkpoint commit**

Commit every T-008 file together, excluding generated output and local artifacts:

```bash
git add packages/db pnpm-lock.yaml tasks.md CURRENT_STATE.md docs/superpowers/plans/2026-09-22-flight-persistence.md docs/superpowers/specs/2026-09-22-flight-persistence-design.md
git commit -m "feat(flights): persist instances snapshots and history"
```

Expected: one focused commit on `feat/t-008-flight-persistence`. If the local Git metadata remains unavailable, create the equivalent GitHub tree/commit from the verified file set and fast-forward only this feature branch.

- [ ] **Step 8: Perform whole-branch review**

Review the complete T-008 diff against the spec and this plan, explicitly checking the five Review Focus cases. Re-grade findings by user impact; fix Critical/Important findings in one TDD pass and record Minor findings for handoff. Re-run `pnpm verify` after any fix before updating the remote checkpoint.

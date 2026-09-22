# Flight Status Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic T-009 status engine that classifies operational/performance state, confirms cancellation only after two consecutive explicit observations, protects terminal facts, and persists the complete decision atomically.

**Architecture:** Add a Prisma-free `@flightcheck/domain` package containing pure performance and operational functions plus a transition-writer service. Extend `@flightcheck/db` with schedule variance and full policy-state compare-and-set fields; T-010 will load current state and call the domain service only for explicitly observed flights.

**Tech Stack:** TypeScript 5.9, Vitest 3, pnpm workspaces, Turborepo, Prisma 7, PostgreSQL/PGlite.

**Spec:** `docs/superpowers/specs/2026-09-22-flight-status-engine-design.md`

## Global Constraints

- Store timestamps in UTC; status arithmetic operates on `Date` instants.
- Keep operational and performance status independent.
- Estimated delay is visible immediately; `actualAt` supersedes `estimatedAt`.
- Cancellation requires two consecutive explicit `CANCELLED` observations; a missing row never calls the engine.
- Preserve the first confirmation timestamp while a confirmed cancellation is replayed or recovered.
- `DEPARTED`, `ARRIVED`, and `DIVERTED` cannot regress to weaker operational states.
- Domain code must not import Prisma, generated DB types, Worker modules, or parser internals.
- Use TDD for every behavior: observe RED before implementation, then GREEN.
- T-009 is one repository Task and ends with one implementation commit: `feat(domain): implement flight status engine`. Do not publish intermediate implementation commits.

## File Structure

- Create `packages/domain/package.json` — workspace scripts, exports, and the flight-source dependency.
- Create `packages/domain/tsconfig.json` — no-emit test/typecheck configuration.
- Create `packages/domain/tsconfig.build.json` — declaration/build output configuration.
- Create `packages/domain/src/status-types.ts` — domain-owned state, decision, reason, and writer-port types.
- Create `packages/domain/src/performance-status.ts` — signed schedule variance and performance classification.
- Create `packages/domain/src/performance-status.test.ts` — time-reference, thresholds, and invalid-date tests.
- Create `packages/domain/src/operational-status.ts` — cancellation/recovery and terminal transition state machine.
- Create `packages/domain/src/operational-status.test.ts` — operational mapping and state-machine tests.
- Create `packages/domain/src/flight-status-engine.ts` — combines both dimensions and delegates one CAS transition.
- Create `packages/domain/src/flight-status-engine.test.ts` — application-service, idempotency, missing-row boundary, and writer-error tests.
- Create `packages/domain/src/index.ts` — explicit public exports.
- Modify `packages/db/prisma/schema.prisma` — add schedule-variance fields.
- Create `packages/db/prisma/migrations/20260922000300_status_engine_policy_fields/migration.sql` — non-destructive nullable columns.
- Modify `packages/db/src/flight-observation-repository.ts` — compare and update the full policy state.
- Modify `packages/db/src/index.ts` — export the expanded transition contract.
- Modify `packages/db/tests/schema-contract.test.ts` — pin new Prisma fields.
- Modify `packages/db/tests/migration.test.ts` — prove new columns on an empty migrated database.
- Modify `packages/db/tests/flight-observation-repository.test.ts` — full-field CAS, history, replay, and stale-writer integration tests.
- Modify `packages/db/README.md` — document the complete T-009 transition contract.
- Modify `pnpm-lock.yaml` — register the new workspace package and dependency.
- Modify `tasks.md` — mark T-009 complete only after all verification passes.
- Modify `CURRENT_STATE.md` — record evidence, decisions, risks, and T-010 as the next action.

## Review Focus

- A sub-minute timestamp near 15 or 60 minutes must truncate toward zero and not cross the threshold; Task 1 adds explicit `14:59` and `59:59` cases.
- `actualAt` earlier than schedule must replace a later estimate, retain negative variance, and expose zero delay; Task 1 pins this precedence.
- `CANCEL_PENDING -> UNKNOWN -> CANCELLED` must restart at count 1 rather than confirm cancellation; Task 2 pins the interrupted sequence.
- A stale writer differing only in cancellation count or confirmation timestamp must be rejected; Task 3 adds both CAS cases.
- A terminal flight may update performance from estimate to actual without regressing operational state; Task 4 exercises the combined decision and persisted transition shape.

---

### Task 1: Domain Package and Performance Classification

**Files:**

- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/tsconfig.build.json`
- Create: `packages/domain/src/status-types.ts`
- Create: `packages/domain/src/performance-status.ts`
- Create: `packages/domain/src/performance-status.test.ts`
- Create: `packages/domain/src/index.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `NormalizedFlight` from `@flightcheck/flight-source`.
- Produces: `FlightStatusState`, `PerformanceDecision`, and `evaluatePerformanceStatus(observation: NormalizedFlight): PerformanceDecision`.

- [ ] **Step 1: Add the workspace package and domain types**

Create package scripts matching other TypeScript packages and define these exact types:

```ts
export type OperationalStatus =
  | 'SCHEDULED'
  | 'DEPARTED'
  | 'ARRIVED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'RECOVERED'
  | 'DIVERTED'
  | 'UNKNOWN';

export type PerformanceStatus =
  'PENDING' | 'ON_TIME' | 'DELAYED' | 'SEVERE_DELAY' | 'UNKNOWN';

export interface FlightStatusState {
  operationalStatus: OperationalStatus;
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
  scheduleVarianceMinutes: number | null;
  cancelledObservedCount: number;
  cancelConfirmedAt: Date | null;
}

export interface PerformanceDecision {
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
  scheduleVarianceMinutes: number | null;
}
```

Set `@flightcheck/domain` exports to development source and production `dist`, depend on `@flightcheck/flight-source: workspace:*`, and use the same build/lint/test/typecheck scripts as that package.

- [ ] **Step 2: Write failing performance tests**

Create table-driven cases with a scheduled instant of `2026-09-22T08:00:00.000Z`:

```ts
it.each([
  ['14 minutes', '2026-09-22T08:14:00.000Z', 'ON_TIME', 14],
  ['15 minutes', '2026-09-22T08:15:00.000Z', 'DELAYED', 15],
  ['59 minutes', '2026-09-22T08:59:00.000Z', 'DELAYED', 59],
  ['60 minutes', '2026-09-22T09:00:00.000Z', 'SEVERE_DELAY', 60],
])('%s', (_, estimatedAt, status, minutes) => {
  expect(
    evaluatePerformanceStatus(flight({ estimatedAt: new Date(estimatedAt) })),
  ).toEqual({
    performanceStatus: status,
    delayMinutes: minutes,
    scheduleVarianceMinutes: minutes,
  });
});
```

Add tests for `14:59` and `59:59` truncation, no reference (`PENDING`),
source `UNKNOWN` without a reference (`UNKNOWN`), early estimate, invalid
scheduled/reference dates throwing `TypeError`, and an early `actualAt`
overriding a late `estimatedAt`:

```ts
expect(
  evaluatePerformanceStatus(
    flight({
      estimatedAt: new Date('2026-09-22T08:20:00.000Z'),
      actualAt: new Date('2026-09-22T07:55:00.000Z'),
    }),
  ),
).toEqual({
  performanceStatus: 'ON_TIME',
  delayMinutes: 0,
  scheduleVarianceMinutes: -5,
});
```

- [ ] **Step 3: Run the performance test and observe RED**

Run: `pnpm --filter @flightcheck/domain test -- performance-status.test.ts`

Expected: FAIL because `performance-status.ts` or `evaluatePerformanceStatus` does not exist.

- [ ] **Step 4: Implement minimal performance rules**

Implement signed truncation and explicit classification:

```ts
const MINUTE_MS = 60_000;

export function evaluatePerformanceStatus(
  observation: NormalizedFlight,
): PerformanceDecision {
  const reference = observation.actualAt ?? observation.estimatedAt;
  if (reference === null) {
    return {
      performanceStatus:
        observation.sourceStatus === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING',
      delayMinutes: null,
      scheduleVarianceMinutes: null,
    };
  }

  const difference = reference.getTime() - observation.scheduledAt.getTime();
  if (!Number.isFinite(difference)) throw new TypeError('Invalid flight time');
  const scheduleVarianceMinutes = Math.trunc(difference / MINUTE_MS);
  const delayMinutes = Math.max(0, scheduleVarianceMinutes);
  const performanceStatus =
    delayMinutes >= 60
      ? 'SEVERE_DELAY'
      : delayMinutes >= 15
        ? 'DELAYED'
        : 'ON_TIME';
  return { performanceStatus, delayMinutes, scheduleVarianceMinutes };
}
```

- [ ] **Step 5: Run package tests, typecheck, and build**

Run: `pnpm --filter @flightcheck/domain test && pnpm --filter @flightcheck/domain typecheck && pnpm --filter @flightcheck/domain build`

Expected: all performance tests pass; TypeScript and build exit 0.

### Task 2: Operational Status State Machine

**Files:**

- Modify: `packages/domain/src/status-types.ts`
- Create: `packages/domain/src/operational-status.ts`
- Create: `packages/domain/src/operational-status.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Consumes: `FlightStatusState`, `SourceFlightStatus`, and `observedAt: Date`.
- Produces: `OperationalDecision` and `evaluateOperationalStatus(current, sourceStatus, observedAt)`.

- [ ] **Step 1: Define stable reason codes and operational output**

Add these exact public types:

```ts
export type StatusReason =
  | 'SOURCE_STATUS'
  | 'FIRST_CANCELLATION_OBSERVATION'
  | 'CANCELLATION_CONFIRMED'
  | 'CANCELLATION_REPLAY'
  | 'CANCELLATION_SEQUENCE_RESET'
  | 'CANCELLATION_RECOVERED'
  | 'RECOVERY_RETAINED'
  | 'TERMINAL_ADVANCE'
  | 'TERMINAL_REGRESSION_BLOCKED';

export interface OperationalDecision {
  operationalStatus: OperationalStatus;
  cancelledObservedCount: number;
  cancelConfirmedAt: Date | null;
  reason: StatusReason;
}
```

- [ ] **Step 2: Write failing state-machine tests**

Cover direct mapping and the full cancellation sequence. Pin the interrupted case:

```ts
const first = evaluateOperationalStatus(initial, 'CANCELLED', at('08:05'));
expect(first).toMatchObject({
  operationalStatus: 'CANCEL_PENDING',
  cancelledObservedCount: 1,
  cancelConfirmedAt: null,
  reason: 'FIRST_CANCELLATION_OBSERVATION',
});

const interrupted = evaluateOperationalStatus(
  { ...initial, ...first },
  'UNKNOWN',
  at('08:10'),
);
expect(interrupted).toMatchObject({
  operationalStatus: 'UNKNOWN',
  cancelledObservedCount: 0,
  reason: 'CANCELLATION_SEQUENCE_RESET',
});

expect(
  evaluateOperationalStatus(
    { ...initial, ...interrupted },
    'CANCELLED',
    at('08:15'),
  ),
).toMatchObject({
  operationalStatus: 'CANCEL_PENDING',
  cancelledObservedCount: 1,
});
```

Also test: second consecutive cancellation confirms at the second `observedAt`; replay retains original time; non-cancel after confirmed becomes `RECOVERED`; recovered weak states remain recovered; recovered terminal state advances; new cancellation after recovery restarts; `DEPARTED -> ARRIVED` advances; every weaker observation against `DEPARTED`, `ARRIVED`, and `DIVERTED` is blocked.

- [ ] **Step 3: Run the operational test and observe RED**

Run: `pnpm --filter @flightcheck/domain test -- operational-status.test.ts`

Expected: FAIL because `evaluateOperationalStatus` is missing.

- [ ] **Step 4: Implement cancellation and terminal rules**

Use explicit helpers and validate current state before branching:

```ts
const TERMINAL = new Set<OperationalStatus>([
  'DEPARTED',
  'ARRIVED',
  'DIVERTED',
]);

function assertCurrentState(current: FlightStatusState): void {
  if (
    !Number.isInteger(current.cancelledObservedCount) ||
    current.cancelledObservedCount < 0
  ) {
    throw new TypeError('Invalid cancellation observation count');
  }
  if (
    current.operationalStatus === 'CANCELLED' &&
    current.cancelConfirmedAt === null
  ) {
    throw new TypeError('Confirmed cancellation requires cancelConfirmedAt');
  }
}
```

Implement branches in this order: validate dates/state; protect or advance terminal state; handle confirmed recovery; retain or advance recovered state; process explicit cancellation; map/reset ordinary source status. Never derive an observation from absence.

- [ ] **Step 5: Run domain tests and typecheck**

Run: `pnpm --filter @flightcheck/domain test && pnpm --filter @flightcheck/domain typecheck`

Expected: all Task 1 and Task 2 tests pass and typecheck exits 0.

### Task 3: Persist Complete Policy State with Compare-and-Set

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260922000300_status_engine_policy_fields/migration.sql`
- Modify: `packages/db/src/flight-observation-repository.ts`
- Modify: `packages/db/tests/schema-contract.test.ts`
- Modify: `packages/db/tests/migration.test.ts`
- Modify: `packages/db/tests/flight-observation-repository.test.ts`

**Interfaces:**

- Consumes: T-008 `recordStatusTransition` and the full `FlightStatusState` shape from Tasks 1–2.
- Produces: expanded `RecordStatusTransitionInput` with expected/target schedule variance, cancellation count, and confirmation time; history with previous/new variance.

- [ ] **Step 1: Write failing schema and migration tests**

Require these Prisma fields:

```prisma
model FlightInstance {
  scheduleVarianceMinutes Int?
}

model FlightStatusHistory {
  previousScheduleVarianceMinutes Int?
  scheduleVarianceMinutes         Int?
}
```

Extend the migration test's expected column lists for both tables, then run:

`pnpm --filter @flightcheck/db test -- schema-contract.test.ts migration.test.ts`

Expected: FAIL because the schema and migration lack the three columns.

- [ ] **Step 2: Add the non-destructive migration and Prisma fields**

Create exactly:

```sql
ALTER TABLE "FlightInstance"
ADD COLUMN "scheduleVarianceMinutes" INTEGER;

ALTER TABLE "FlightStatusHistory"
ADD COLUMN "previousScheduleVarianceMinutes" INTEGER,
ADD COLUMN "scheduleVarianceMinutes" INTEGER;
```

Run: `pnpm --filter @flightcheck/db test -- schema-contract.test.ts migration.test.ts`

Expected: schema and migration tests pass.

- [ ] **Step 3: Expand repository tests before the implementation**

Every transition call must now include:

```ts
expectedScheduleVarianceMinutes: null,
expectedCancelledObservedCount: 0,
expectedCancelConfirmedAt: null,
scheduleVarianceMinutes: 20,
cancelledObservedCount: 1,
cancelConfirmedAt: null,
```

Assert that a real transition updates all instance fields and history variance. Add two stale tests: one where only `cancelledObservedCount` changed and one where only `cancelConfirmedAt` changed. Add an identical-winner case including all fields.

Run: `pnpm --filter @flightcheck/db test -- flight-observation-repository.test.ts`

Expected: FAIL because the repository contract ignores the new fields.

- [ ] **Step 4: Expand the CAS contract and transaction**

Add these fields to `RecordStatusTransitionInput`:

```ts
expectedScheduleVarianceMinutes: number | null;
expectedCancelledObservedCount: number;
expectedCancelConfirmedAt: Date | null;
scheduleVarianceMinutes: number | null;
cancelledObservedCount: number;
cancelConfirmedAt: Date | null;
```

Include all six policy fields in `selectStatus`, `currentIsTarget`, and `currentIsExpected`. Include expected values in `updateMany.where`, target values in `updateMany.data`, and winner comparison. Use explicit nullable equality in Prisma and compare timestamps by value:

```ts
function datesEqual(left: Date | null, right: Date | null): boolean {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}
```

Write previous/new schedule variance into `FlightStatusHistory`. Retain the existing transaction, identical-winner no-op, stale error wrapping, and history-only-on-change behavior.

- [ ] **Step 5: Run DB verification**

Run: `pnpm --filter @flightcheck/db test && pnpm --filter @flightcheck/db typecheck && pnpm --filter @flightcheck/db build`

Expected: all DB tests pass, including full-field stale rejection and migration rebuild.

### Task 4: Combined Engine Service, Documentation, and T-009 Checkpoint

**Files:**

- Create: `packages/domain/src/flight-status-engine.ts`
- Create: `packages/domain/src/flight-status-engine.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/db/README.md`
- Modify: `CURRENT_STATE.md`
- Modify: `tasks.md`

**Interfaces:**

- Consumes: `evaluatePerformanceStatus`, `evaluateOperationalStatus`, expanded `recordStatusTransition` structural shape.
- Produces: `FlightStatusTransitionWriter`, `ApplyFlightStatusObservationInput`, and `applyFlightStatusObservation(input): Promise<StatusApplicationResult>` for T-010.

- [ ] **Step 1: Define the writer port and write failing combined tests**

Define a Prisma-free structural port:

```ts
export interface FlightStatusTransitionWriter {
  recordStatusTransition(input: {
    flightInstanceId: string;
    expectedOperationalStatus: OperationalStatus;
    expectedPerformanceStatus: PerformanceStatus;
    expectedDelayMinutes: number | null;
    expectedScheduleVarianceMinutes: number | null;
    expectedCancelledObservedCount: number;
    expectedCancelConfirmedAt: Date | null;
    operationalStatus: OperationalStatus;
    performanceStatus: PerformanceStatus;
    delayMinutes: number | null;
    scheduleVarianceMinutes: number | null;
    cancelledObservedCount: number;
    cancelConfirmedAt: Date | null;
    reason: StatusReason;
    observedAt: Date;
  }): Promise<{ changed: boolean }>;
}
```

With a fake writer, assert the service submits one complete transition, returns the derived decision plus `{ changed }`, passes through a writer error, and allows terminal operational protection while changing estimate-based performance to actual-based performance.

Pin the missing-row boundary without inventing a source status:

```ts
const observations: NormalizedFlight[] = [];
for (const observation of observations) {
  await applyFlightStatusObservation(inputFor(observation));
}
expect(writer.recordStatusTransition).not.toHaveBeenCalled();
```

This establishes that only explicit normalized observations reach the engine;
T-010 will own the batch iteration and coverage handling. Do not add a
`MISSING` source status.

- [ ] **Step 2: Run the service test and observe RED**

Run: `pnpm --filter @flightcheck/domain test -- flight-status-engine.test.ts`

Expected: FAIL because the service and writer port do not exist.

- [ ] **Step 3: Implement the combined decision and one writer call**

Build the target from the two pure decisions and preserve the current state as the expected half:

```ts
const operational = evaluateOperationalStatus(
  input.current,
  input.observation.sourceStatus,
  input.observedAt,
);
const performance = evaluatePerformanceStatus(input.observation);
const target = { ...input.current, ...operational, ...performance };

const result = await input.writer.recordStatusTransition({
  flightInstanceId: input.flightInstanceId,
  expectedOperationalStatus: input.current.operationalStatus,
  expectedPerformanceStatus: input.current.performanceStatus,
  expectedDelayMinutes: input.current.delayMinutes,
  expectedScheduleVarianceMinutes: input.current.scheduleVarianceMinutes,
  expectedCancelledObservedCount: input.current.cancelledObservedCount,
  expectedCancelConfirmedAt: input.current.cancelConfirmedAt,
  operationalStatus: target.operationalStatus,
  performanceStatus: target.performanceStatus,
  delayMinutes: target.delayMinutes,
  scheduleVarianceMinutes: target.scheduleVarianceMinutes,
  cancelledObservedCount: target.cancelledObservedCount,
  cancelConfirmedAt: target.cancelConfirmedAt,
  reason: target.reason,
  observedAt: input.observedAt,
});
return { ...result, decision: target };
```

Do not catch repository errors; T-010 must distinguish and re-evaluate stale work.

- [ ] **Step 4: Run all domain and DB tests**

Run: `pnpm --filter @flightcheck/domain test && pnpm --filter @flightcheck/db test`

Expected: all domain and DB tests pass.

- [ ] **Step 5: Update durable documentation and state**

Document the signed variance, two-observation cancellation contract, full CAS fields, and T-010 retry responsibility in `packages/db/README.md`. Update `tasks.md` to `[x] T-009` only after verification. Update `CURRENT_STATE.md` with:

- T-001 through T-009 verified;
- branch and implementation evidence identified as the current T-009 commit;
- exact test totals and commands from the fresh verification output;
- no missing-row cancellation inference;
- next action `T-010 — Flight Sync Use Case 與 Worker`.

- [ ] **Step 6: Run formatting and targeted verification**

Run:

```bash
pnpm format:check
pnpm --filter @flightcheck/domain lint
pnpm --filter @flightcheck/domain typecheck
pnpm --filter @flightcheck/domain test
pnpm --filter @flightcheck/domain build
pnpm --filter @flightcheck/db lint
pnpm --filter @flightcheck/db typecheck
pnpm --filter @flightcheck/db test
pnpm --filter @flightcheck/db build
```

Expected: every command exits 0 with no skipped status-engine or DB contract tests.

- [ ] **Step 7: Run fresh repository-wide verification**

Run:

```bash
TURBO_FORCE=true TZ=Asia/Macau \
DATABASE_URL=postgresql://flightcheck:flightcheck@127.0.0.1:5432/flightcheck \
pnpm verify
```

Expected: formatting, lint, typecheck, forced uncached tests, and production builds pass for every workspace, including `@flightcheck/domain`.

- [ ] **Step 8: Create the single T-009 implementation commit**

Stage only T-009 files; exclude generated Prisma client, `dist`, `.next`, `node_modules`, `.superpowers`, and `FlightCheck_IMPLEMENTATION_TASKS_CHECKPOINTS.md`.

```bash
git add packages/domain packages/db/prisma/schema.prisma \
  packages/db/prisma/migrations/20260922000300_status_engine_policy_fields \
  packages/db/src/flight-observation-repository.ts packages/db/src/index.ts \
  packages/db/tests packages/db/README.md pnpm-lock.yaml tasks.md CURRENT_STATE.md
git commit -m "feat(domain): implement flight status engine"
```

- [ ] **Step 9: Prepare final review**

Review the complete implementation range from the plan checkpoint to the T-009 commit. Check all five Review Focus cases, spec coverage, migration safety, package boundaries, and full-field CAS behavior. Re-grade findings by user impact; fix Critical/Important findings in one RED→GREEN pass, record deferred Minor findings, rerun `pnpm verify`, and amend the unpushed implementation commit or create one focused review-fix commit if already published.

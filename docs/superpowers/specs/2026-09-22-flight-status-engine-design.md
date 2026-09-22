# Flight Status Engine Design

> Task: T-009 Status Engine  
> Date: 2026-09-22  
> Status: Approved design

## Purpose

T-009 turns each explicit normalized airport observation into a deterministic
operational and performance decision. The rules live in `packages/domain`, not
in the parser, persistence repository, Worker, route handlers, or UI.

The engine must preserve the P0 distinction between operational state and
performance state, require two consecutive explicit cancellation observations,
record early operation without negative delay, and reject regressions from
terminal operational states.

## Scope

T-009 includes:

- pure status and schedule-variance rules;
- cancellation confirmation, reset, and recovery rules;
- terminal-state regression protection;
- a small application service that evaluates an observation and delegates one
  atomic compare-and-set transition to a persistence port;
- database fields and history required to persist the complete decision;
- unit, contract, migration, and integration tests for those rules.

T-009 does not fetch airport pages, infer cancellation from a missing row,
schedule the five-minute sync, calculate daily statistics, or create SNS
events. T-010 owns sync orchestration; T-011 owns statistics; T-015 owns
cancellation events.

## Package Boundary

Create `@flightcheck/domain` in `packages/domain`.

The package may consume the stable normalized-flight contract from
`@flightcheck/flight-source`. It must not import Prisma, generated database
types, HTML parsing code, or Worker modules.

The public API has two layers:

1. Pure functions evaluate performance and operational state.
2. `applyFlightStatusObservation` accepts the current persisted state, one
   explicit observation, `observedAt`, and a structural transition-writer port.
   It derives one complete target decision and submits one compare-and-set
   transition.

The returned decision contains a stable reason code so status history is
auditable without parsing prose.

## Current State and Decision Shape

The engine's current-state input contains:

- `operationalStatus`;
- `performanceStatus`;
- `delayMinutes`;
- `scheduleVarianceMinutes`;
- `cancelledObservedCount`;
- `cancelConfirmedAt`.

The target decision contains the same fields plus a reason code. A missing
flight row is not an input variant: callers do not invoke the engine for a
missing row, so disappearance cannot change state or cancellation count.

## Performance Rules

The time reference is `actualAt` when present, otherwise `estimatedAt`. This
means an estimated delay is visible before departure or arrival and actual time
supersedes the estimate once available.

`scheduleVarianceMinutes` is the signed whole-minute difference between the
reference time and `scheduledAt`:

- negative means early;
- zero means exactly scheduled;
- positive means late.

Airport observations use minute precision. If a caller supplies sub-minute
timestamps, the engine truncates the signed difference toward zero so a partial
minute does not cross a threshold.

`delayMinutes = max(0, scheduleVarianceMinutes)`. Classification is:

- 0–14 minutes: `ON_TIME`;
- 15–59 minutes: `DELAYED`;
- 60 minutes or more: `SEVERE_DELAY`.

When neither actual nor estimated time exists, performance is `PENDING`, except
an explicit source `UNKNOWN` produces `UNKNOWN`. A cancelled or
cancel-pending observation without a usable time remains `PENDING`; cancellation
is represented by the independent operational dimension.

## Operational Rules

Source statuses normally map directly:

- `SCHEDULED` and `DELAYED` -> `SCHEDULED`;
- `DEPARTED` -> `DEPARTED`;
- `ARRIVED` -> `ARRIVED`;
- `DIVERTED` -> `DIVERTED`;
- `UNKNOWN` -> `UNKNOWN`;
- `CANCELLED` uses the confirmation state machine below.

### Cancellation State Machine

For a non-terminal current state:

1. First explicit `CANCELLED` observation sets `CANCEL_PENDING` and count 1.
2. The immediately following explicit `CANCELLED` observation sets `CANCELLED`,
   count 2, and `cancelConfirmedAt = observedAt`.
3. Repeated `CANCELLED` observations while already confirmed are idempotent and
   retain the original confirmation time.
4. Any explicit non-cancelled observation, including `UNKNOWN`, breaks the
   sequence and resets the count to zero.
5. A confirmed `CANCELLED` followed by an explicit non-cancelled observation
   becomes `RECOVERED`, resets the count, and retains `cancelConfirmedAt` as
   historical evidence.
6. A new cancellation after recovery starts a fresh two-observation sequence.

`RECOVERED` is the immediate correction state. A later explicit `DEPARTED`,
`ARRIVED`, or `DIVERTED` observation may advance to that terminal state. A later
scheduled, delayed, or unknown observation remains `RECOVERED` so the recovery
is not erased by a weaker source status.

### Terminal Regression Protection

`DEPARTED`, `ARRIVED`, and `DIVERTED` are protected terminal facts. Once
persisted, later scheduled, delayed, unknown, or cancelled observations do not
change operational status or start cancellation confirmation. A stronger
forward observation may advance `DEPARTED` to `ARRIVED`; other terminal-to-
terminal conflicts retain the existing state because the source does not
provide enough evidence to rewrite history.

Performance fields may still move from an estimate to an actual time while the
operational terminal state remains protected.

## Persistence Contract

Add nullable `scheduleVarianceMinutes` to `FlightInstance` and add previous/new
schedule-variance columns to `FlightStatusHistory`.

Extend T-008 `RecordStatusTransitionInput` so both expected and target state
cover:

- operational status;
- performance status;
- delay minutes;
- schedule variance minutes;
- cancelled-observation count;
- cancellation confirmation timestamp.

The repository compares all expected fields and updates all target fields in
the same transaction. It writes one history row only when the material target
differs. If another worker already wrote the identical target, the call is an
idempotent no-op; any other expected-state mismatch is stale and must be
re-evaluated by the caller.

History records previous/new operational status, performance status, delay,
and schedule variance. Cancellation count and confirmation time remain on the
instance; the operational transition and reason code provide the audit trail.

## Error Handling

The pure engine rejects invalid dates, non-finite time differences, negative
cancellation counts, and inconsistent confirmed cancellation state. The
application service preserves repository errors so T-010 can retry stale work
by reloading current state rather than blindly overwriting it.

Unknown source status is a valid observation and produces a deterministic
decision; malformed normalized observations remain the source adapter's
responsibility.

## Testing

Unit tests cover:

- 14, 15, 59, and 60-minute boundaries;
- early, exact, estimated, and actual-over-estimated timing;
- scheduled, departed, arrived, diverted, and unknown mappings;
- first and second explicit cancellation observations;
- interrupted cancellation sequences and reset;
- confirmed cancellation recovery and post-recovery advancement;
- missing-row behavior by proving no engine call is required;
- terminal regression protection;
- identical decision idempotency and stable confirmation time.

Database tests cover the migration, full-field compare-and-set behavior,
history values, identical-winner deduplication, and stale-writer rejection.
Repository-wide verification remains `pnpm verify` with the required test
database environment.

## Acceptance Mapping

The detailed backlog refers to B01–B12 without publishing separate prose for
each identifier. T-009 therefore maps the twelve acceptance cases to the core
observable behaviors: operational mapping, performance thresholds, early
variance, estimate handling, first cancellation, confirmed cancellation,
sequence reset, missing-row safety, recovery, terminal protection, idempotent
replay, and stale concurrent decisions.

## Handoff to T-010

T-010 loads each persisted instance state, invokes the T-009 application
service only for flights explicitly present in a usable source result, and
retries a stale transition only after reloading and re-evaluating. Partial or
failed source coverage never fabricates missing observations.

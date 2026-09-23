# Flight Sync Worker Design

## Intent

T-010 turns the source, persistence, and status-policy components from T-006
through T-009 into one resilient synchronization workflow. Scheduled and
manual executions must share the same use case, respect one global lease, keep
departure and arrival failures isolated, and never infer cancellation from an
absent board row.

## Scope

T-010 delivers:

- a reusable `FlightSyncService` in the Worker application;
- independent departure and arrival fetch/run processing;
- database repositories for `JobLock`, `ScrapeRun`, and current status state;
- status-engine application with one stale-decision reload and re-evaluation;
- a five-minute Worker schedule and an immediate startup sync;
- a validated manual CLI with an optional Macau service date;
- structured source-health results suitable for future Admin and quality work.

T-010 does not deliver the Admin API/UI, the T-012 quality evaluator, or the
T-027 scheduler registry, heartbeat, and startup-recovery system.

## Architecture

The Worker owns orchestration and depends on ports exposed by the existing
packages:

- `@flightcheck/flight-source` fetches and normalizes airport data;
- `@flightcheck/db` owns Prisma transactions, locks, runs, observations, and
  state loading;
- `@flightcheck/domain` evaluates and atomically writes status transitions;
- `@flightcheck/shared` supplies Macau time, correlation IDs, and logging.

Domain remains Prisma-free. DB does not depend on the source adapter or Worker.
The CLI and timer call the same service rather than duplicating sync rules.

## Direction Isolation

Each synchronization calls the source twice in parallel: once with
`directions: ['DEPARTURE']` and once with `directions: ['ARRIVAL']`. Each
direction owns one `ScrapeRun` because the existing schema represents source
health as `DEPARTURES` or `ARRIVALS`.

A successful direction persists observations and applies status decisions even
when the other direction fails. Overall results are:

- `SUCCESS` when both directions succeed;
- `PARTIAL` when one direction fails or either usable direction is partial;
- `FAILED` when both directions fail, or when a processing failure prevents a
  usable direction from completing;
- `SKIPPED_LOCKED` when another owner holds the global lease.

A failed source result never calls observation persistence or the status
engine. Missing flights never become observations.

## Synchronization Flow

`FlightSyncService.run({ serviceDate, trigger })` performs:

1. Generate one owner/correlation ID and atomically acquire `flight-sync`.
2. If acquisition fails, return `SKIPPED_LOCKED` without creating false failed
   source runs.
3. Create one running `ScrapeRun` for each direction.
4. Fetch both directions concurrently through isolated source requests.
5. For each usable result, persist its flights, snapshots, and warnings.
6. Resolve each persisted flight to its `FlightInstance` and load the complete
   T-009 status state, including `lastStatusObservedAt`.
7. Call `applyFlightStatusObservation` only for explicit normalized flights.
8. On a stale compare-and-set error, reload state and re-evaluate once. A
   second stale conflict fails that direction rather than blindly retrying the
   old target.
9. Complete each `ScrapeRun` with timestamps, counts, warnings, and a stable
   error code.
10. Release the lease only when its owner still matches.

The lock is released in `finally`; run completion errors remain visible and do
not get converted into success.

## Job Lock Contract

The DB repository exposes atomic acquire, renew, and release operations.

- Acquisition creates the lock when absent or replaces it only when expired.
- A live lock held by another owner is not modified.
- Renew and release require both lock name and matching owner ID.
- The lease duration exceeds the normal source timeout/retry window.
- T-010 may renew at safe workflow boundaries; continuous heartbeat belongs to
  T-027.

Tests inspect conflict-safe SQL in addition to PGlite behavior because PGlite
serializes transactions.

## Scrape Runs and Source Health

Every acquired sync creates two directional runs. A run records correlation ID,
start/finish time, fetched/source update time, row and NX-flight counts,
warnings, and error code.

- usable result without warnings: `SUCCESS`;
- usable result with warnings or source status `PARTIAL`: `PARTIAL`;
- source or processing failure: `FAILED`.

T-010 exposes these results for monitoring, but does not calculate T-012's
`COMPLETE`/`DEGRADED` daily quality decision.

## Scheduling and Manual Execution

The Worker starts one sync immediately, then schedules subsequent attempts at a
fixed five-minute interval. Timer, clock, and service dependencies are
injectable so tests use fake time. JobLock remains the authority if a previous
attempt overlaps a later tick or another process.

The manual CLI accepts `--date YYYY-MM-DD`; without it, the Macau-local current
date is used. Invalid or unknown arguments fail before acquiring the lock. The
CLI returns a nonzero exit code for `FAILED`, while `SUCCESS`, `PARTIAL`, and
`SKIPPED_LOCKED` are reported explicitly. A protected Admin API/UI remains
T-023 scope and will reuse the same service.

On termination the Worker stops scheduling new attempts and allows an active
attempt to settle. Full signal recovery and scheduler coordination remain
T-027 scope.

## Errors and Observability

Known source failures retain their stable source error codes. Persistence,
state-load, or exhausted-CAS failures use stable Worker error categories and
preserve the original cause. One correlation ID connects lock activity,
directional runs, counts, warnings, and final status. Logs never include
credentials or unrestricted source payloads.

## Testing and Acceptance

TDD covers:

- two simultaneous runs with only one lock winner;
- lock ownership, expiry takeover, renewal, and release;
- departure success plus arrival failure yielding `PARTIAL` while preserving
  departure data;
- both source failures producing no observations;
- two fixture rounds advancing cancellation pending to confirmed;
- identical-observation replay producing no duplicate instance/snapshot and no
  cancellation advancement;
- absent rows never calling the status engine;
- one stale transition reload/re-evaluation and a second conflict failure;
- scheduler immediate start and five-minute cadence with fake time;
- CLI date parsing, output, and exit codes;
- repository migration/integration behavior and full repository verification.

T-010 completes only after targeted Worker/DB integration tests and fresh
repository-wide `pnpm verify` pass.

## Durable Decisions

- Manual execution is a CLI plus reusable use case; Admin API/UI is T-023.
- Departures and arrivals use separate source calls and separate `ScrapeRun`s.
- Partial source success is committed rather than rolled back with the failed
  direction.
- Missing rows have no status meaning.
- A stale status decision is recomputed once, never replayed unchanged.
- T-010 installs only the minimal interval loop; advanced recovery remains
  T-027.

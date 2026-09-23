# FlightCheck Current State

> Updated: 2026-09-22  
> Branch: `feat/t-010-flight-sync-worker`  
> Baseline commit: `c4112760556e72d580d87fe0a68ff80b5bd2d2de`

## Project Phase

CP-02 implementation is complete through T-010, its automated gate is green,
and annotated tag `cp-02-flight-engine` points to the verified checkpoint commit.
The approved First Release Fast Track is active at FR-01/T-011. It targets a
production-safe public release before the deferred SNS and complete Admin scope;
the original T-001–T-032 P0 backlog remains authoritative.

The repository began with documentation only. It now contains:

- `docs/P0_v1.2.md` — frozen P0 product specification.
- `docs/IMPLEMENTATION_TASKS.md` — detailed T-001 through T-032 backlog and CP-01 through CP-06 gates.
- `AGENTS.md` — persistent implementation and handoff rules.
- `tasks.md` — task/checkpoint status ledger.
- `CURRENT_STATE.md` — this handoff.
- `apps/web` — Next.js App Router foundation and HTTP health endpoint.
- `apps/worker` — Node.js Worker foundation and health contract.
- `packages/shared` — validated environment, Macau time, correlation ID and structured logging utilities.
- `packages/db` — Prisma 7 schema, generated-client factory, initial PostgreSQL migration and idempotent seed.
- `packages/domain` — pure operational/performance status policy and atomic transition service.
- `packages/flight-source` — airport source contracts, Macau Airport HTTP client, fixture-driven parser, IATA dictionary, normalization adapter and sanitized source fixtures.
- Admin authentication — Argon2id passwords, database-backed sessions, hardened cookies, rate limiting, route protection and audit logs.
- Root pnpm/Turborepo, TypeScript, Tailwind, ESLint, Prettier, Vitest and Playwright tooling.
- `.github/workflows/ci.yml` — install and full verification workflow.

## Scope Decisions Already Fixed

- Stack: Next.js App Router, TypeScript, Tailwind CSS, PostgreSQL, Prisma, Zod and a persistent Node.js Worker.
- Source: Macau International Airport public Departures/Arrivals pages via HTTP and HTML parsing; no paid flight API and no Playwright in P0.
- Airline: Air Macau (`NX`) only.
- Time zone: `Asia/Macau`; persistence timestamps use UTC.
- Cancellation: two consecutive explicit confirmations; disappearance is not cancellation.
- Cancellation SNS: one post per flight, scheduled in its original departure-hour window; publish immediately if confirmation is already within or after that window.
- Platforms: Threads and Facebook tracked and retried separately.
- Daily SNS: 23:30 after pre-sync/statistics/quality check; publish automatically only with COMPLETE data quality.
- Deployment target: Docker Compose on a VPS, with Web and Worker separated.

## Completed Work

| Item                                | Status                         | Evidence                                                                               |
| ----------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| P0 v1.2 scope specification         | Complete                       | `docs/P0_v1.2.md`; commit `3d36fe66d7ab333c01accd208c59a5475f0c1171`                   |
| Initial implementation backlog      | Superseded by expanded backlog | commit `d87bc1446daad55b0aa0bc0a2bee4cc8bdae34b1`                                      |
| Expanded T-001–T-032 plan           | Complete                       | `docs/IMPLEMENTATION_TASKS.md`; commit `3dcb391ac9a90d0918bb3e0a94fcd0a64d1fb617`      |
| Persistent context/checkpoint files | Complete                       | `AGENTS.md`, `CURRENT_STATE.md`, `tasks.md`                                            |
| T-001 engineering baseline          | Complete                       | Web/Worker workspace, health tests, CI and full verification in this Task commit       |
| T-002 config and observability      | Complete                       | Zod env validation, Macau time helpers, correlation IDs and redacted JSON logging      |
| T-003 PostgreSQL／Prisma schema     | Complete                       | 15 P0 models, initial migration, constraints, client factory and idempotent seed       |
| T-004 Admin authentication          | Complete                       | Argon2id, hashed sessions, hardened cookies, rate limit, proxy guard and audit         |
| T-005 Flight source contracts       | Complete                       | Adapter, raw/normalized schemas, warnings and discriminated fetch results              |
| T-006 Macau Airport HTTP client     | Complete                       | Official board URLs, timeout/retry policy, source timestamps and sanitized fixtures    |
| T-007 Macau Airport parser          | Complete                       | NX filtering, IATA/status/time normalization, warnings, deduplication and adapter      |
| T-008 Flight persistence            | Complete                       | Atomic upserts, changed-only snapshots, warning storage and guarded status history     |
| T-009 Status engine                 | Complete                       | Pure status policy, cancellation confirmation, terminal protection and full CAS        |
| T-010 Flight sync Worker            | Complete                       | Global lease, directional runs, stale re-evaluation, CLI and five-minute scheduler     |
| T-011 Statistics engine             | Complete                       | Pure full-dataset aggregation, truthful denominators and null zero-denominator rates   |
| T-012 Data quality                  | Complete                       | Direction coverage, freshness and critical-warning reasons with conservative watermark |

## Active Checkpoint

`FR-01 — Truthful statistics`

## Active Task

`T-013 — Daily Settlement 與重算` is next. `T-012 — Data Quality 與 Monitoring
Gap` is verified. It requires both source directions, applies an explicit
freshness limit, aggregates warning evidence and reports stable degradation
reason codes. The combined `lastSuccessfulAt` is the older direction watermark.

`T-011 — Statistics Engine` is verified. It recalculates daily totals from complete input collections,
separates direction and determined/pending counts, counts operational
cancellations independently, and returns null rates when no denominator exists.

`T-010 — Flight Sync Use Case 與 Worker` is verified. One reusable Worker
service performs separate concurrent departure/arrival calls under the global
`flight-sync` lease. Each direction owns its ScrapeRun and commits independently;
FAILED source results never persist observations, while usable PARTIAL results,
including zero-flight results, remain truthful PARTIAL runs. Only explicit
persisted instances reach the status engine. A stale transition reloads the full
post-persistence policy state and re-evaluates once; a second conflict fails the
direction with `STATUS_CONFLICT`.

The same use case powers the validated manual CLI and the startup/five-minute
scheduler. Timer failures are logged without stopping later ticks. Shutdown
signals stop new scheduling. The protected Admin trigger remains T-023 scope;
heartbeat, registry, and recovery coordination remain T-027 scope.

T-004 uses Argon2id for password hashes. Successful login creates a random 256-bit raw token, stores only its SHA-256 hash, and sends the raw value in an eight-hour `__Host-` cookie with `HttpOnly`, `Secure`, `SameSite=Strict` and root path. Logout atomically revokes the matching session; expired, revoked or inactive-admin sessions cannot authenticate. Login capacity is reserved atomically under PostgreSQL advisory locks before Argon2 verification, with a five-attempt rolling 15-minute limit applied to both account and source. Forwarded IP headers are ignored unless a trusted ingress is explicitly configured. Admin pages and `/api/admin/*` are protected by the Next.js proxy except the login endpoint.

The bootstrap command `pnpm --filter @flightcheck/web admin:create` requires `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `DATABASE_URL`, enforces a 12-character minimum, and refuses to overwrite an existing administrator.

T-005 introduced `@flightcheck/flight-source` as the only contract boundary for airport data. `RawAirportFlight` preserves source text for the future parser; `NormalizedFlight` exposes UTC instants plus the Macau-local service date. `FlightSourceFetchResult` is a runtime-validated discriminated union for COMPLETE, PARTIAL and FAILED observations. Failed observations cannot contain flights, preventing timeout, HTTP failure or malformed source data from being treated as an empty flight board. Flight numbers remain strings and accept suffixes such as `NX862D`. No HTML parser dependency is present in the contract package.

T-006 added a native-fetch HTTP client for the official Macau Airport Departures and Arrivals pages. Each attempt has a 10-second timeout and at most three attempts with exponential delay; HTTP 408, 429, 5xx, timeout and network failures are retryable, while ordinary 4xx and malformed boards are not. The client fetches both directions concurrently, validates direction-specific board markers after redirects, preserves a successful direction as PARTIAL when the other fails, and returns FAILED with no documents when none succeed. `fetchedAt` records receipt time and a strictly valid Macau-local update label is converted to a UTC `sourceUpdatedAt`. Sanitized, structurally representative fixtures retain desktop/mobile rows without remote assets or request metadata. Flight-row parsing remains deferred to T-007.

T-007 added a Cheerio parser behind `MacauAirportFlightSource`. It reads only top-level desktop cells, filters to valid `NX` flight numbers while preserving letter suffixes, resolves known airport names through a safe local IATA map, validates every output against `NormalizedFlightSchema`, and converts Macau-local service/status times to UTC. Actual times choose the nearest date around the scheduled instant, including midnight rollover; equal-distance cases remain unresolved with `AMBIGUOUS_TIME`. Delay-until timestamps must be at or after the scheduled instant, allowing explicit next-day long delays. Source statuses map to scheduled, delayed, departed, arrived, cancelled, diverted or unknown. Unknown airports/statuses, missing statuses, malformed or structurally unrecognized rows and duplicates emit warnings instead of guesses. Identical flights are deduplicated by service date, direction and flight number; conflicting duplicates are suppressed rather than exposing an arbitrary cancellation or departure. Missing service-date coverage is PARTIAL, any parser warning or unavailable direction is PARTIAL, and total HTTP failure remains FAILED with no flights.

T-008 added `FlightObservationRepository` to `@flightcheck/db`. Each normalized batch validates the source contract and atomically upserts flights/instances, replaces `ScrapeRun` warnings and writes only material snapshots. Canonical SHA-256 payloads exclude observation/run metadata, while database `ON CONFLICT` and unique constraints make new-flight and snapshot discovery replay-safe. Arrival and departure remain distinct through the existing natural key. Status persistence requires the T-009 caller's expected state, conditionally writes the target, records previous/new values, deduplicates an identical winner and rejects stale policy decisions. Migration `20260922000200_status_history_previous_values` adds nullable previous-state columns. Turbo now orders each package test after its own build to prevent concurrent Prisma generation.

T-009 added the Prisma-free `@flightcheck/domain` package. Performance classification uses `actualAt` before `estimatedAt`, preserves signed whole-minute schedule variance, exposes non-negative delay, and applies the 15/60-minute thresholds immediately. Operational policy requires two consecutive explicit cancellation observations, resets an interrupted sequence, retains the first cancellation-confirmation timestamp through replay and recovery, and blocks terminal regressions while allowing `DEPARTED` to advance to `ARRIVED`. Replayed or out-of-order observation timestamps cannot advance cancellation, interrupted recancellation restores `RECOVERED`, and weaker timing evidence cannot erase terminal performance. The combined service produces one complete transition and delegates a single writer call. Migrations `20260922000300_status_engine_policy_fields` and `20260922000400_status_observation_watermark` store variance, cancellation policy fields and the processing watermark; the DB repository compares every policy field atomically and records previous/new variance in status history. T-010 owns current-state loading and stale-decision retry orchestration.

## Verification Baseline

- `pnpm install --frozen-lockfile` passes using pnpm 11.19.0.
- T-012 targeted verification passes: Flight Source 35 tests, Domain 62 tests,
  DB 46 tests, and Worker 30 tests.
- `TURBO_FORCE=true TZ=Asia/Macau DATABASE_URL=postgresql://flightcheck:flightcheck@127.0.0.1:5432/flightcheck pnpm verify`
  passes: formatting, all 6 package lint/typecheck/build tasks, and 215 tests
  (Shared 15, Flight Source 35, Domain 62, DB 46, Worker 30, Web 27).

### T-012 — Data Quality 與 Monitoring Gap

- Commit: `feat(statistics): add data quality evaluation`
- Verification: Domain 62 tests passed; fresh `pnpm verify` → 215 tests and all
  6 package lint/typecheck/build tasks passed.
- Decisions: COMPLETE requires fresh evidence for both directions and no
  critical warning; simultaneous gaps retain all stable reason codes; the
  combined freshness watermark is the older successful direction.
- Follow-up: implement T-013 persistence, settlement and recalculation.

### T-011 — Statistics Engine

- Commit: `feat(statistics): implement daily aggregation engine`
- Verification: Domain 56 tests passed; fresh `pnpm verify` → 209 tests and all
  6 package lint/typecheck/build tasks passed.
- Decisions: recompute from the supplied complete FlightInstance dataset;
  cancellation remains in total; PENDING and UNKNOWN performance are excluded
  from punctuality; zero denominators return null.
- Follow-up: implement T-012 data-quality and monitoring-gap evaluation.

### T-010 — Flight Sync Use Case 與 Worker

- Commit: `feat(worker): add resilient flight sync job` (this implementation commit)
- Verification: CP-02 targeted package suites → 164 tests passed; fresh
  `pnpm verify` → 206 tests and all 6 package lint/typecheck/build passed.
- Decisions: one global owner-qualified lease; separate concurrent directional
  runs; partial direction commits independently; missing rows have no status
  meaning; stale CAS reloads and re-evaluates once; CLI and timer share one use
  case.
- Follow-up: implement T-011 through T-013 for FR-01, then build the public
  product in FR-02.
- DB integration tests apply every migration in order to an empty embedded PostgreSQL instance, enforce event/post and snapshot uniqueness, verify conflict-safe SQL/status CAS behavior, and run the Prisma seed twice without duplicates.
- Next.js production build exposes the public routes, protected `/admin`, login UI and three Admin auth endpoints; its database-backed proxy compiles successfully. Worker compiles to `dist/`.
- The auth integration test uses embedded PostgreSQL to prove login, audit creation, session authentication, logout revocation and prevention of token reuse. Unit/route tests cover Argon2id, cookie flags, throttling and unauthorized page/API handling.
- `/api/health` returns the health contract with an `x-correlation-id` response header; Worker startup emits a structured `worker.ready` record with a job correlation ID.
- Playwright configuration and a browser smoke test exist. Chromium could not be downloaded in this managed environment because the endpoint returned a zero-byte archive; run `pnpm exec playwright install chromium && pnpm test:e2e` on CI or a normal development host.

## Known Risks

- Macau Airport may change its public HTML structure. The client rejects pages without the board marker, while parser behavior is pinned to sanitized fixtures and surfaces malformed rows as warnings.
- The airport dictionary intentionally covers observed P0 destinations. Newly observed names remain code-null with `UNKNOWN_AIRPORT` until reviewed and added; the parser does not infer IATA codes.
- PGlite serializes transaction execution, so concurrency tests also assert conflict-safe emitted SQL and stale expected-state rejection; production PostgreSQL remains the final concurrency authority.
- Threads/Facebook credentials and production authorization are not yet validated. They are not required before T-017/T-018.
- Exact production VPS details are intentionally deferred to T-031.

## Next Exact Action

Implement `T-013 — Daily Settlement 與重算` using the approved Fast Track plan.

```text
feat(worker): add resilient flight sync job
```

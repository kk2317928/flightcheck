# FlightCheck Current State

> Updated: 2026-09-22  
> Branch: `feat/t-002-config-observability`  
> Baseline commit inspected: `3dcb391ac9a90d0918bb3e0a94fcd0a64d1fb617`

## Project Phase

CP-01 implementation is active. T-001 and T-002 are complete; T-003 is next.

The repository began with documentation only. It now contains:

- `docs/P0_v1.2.md` — frozen P0 product specification.
- `docs/IMPLEMENTATION_TASKS.md` — detailed T-001 through T-032 backlog and CP-01 through CP-06 gates.
- `AGENTS.md` — persistent implementation and handoff rules.
- `tasks.md` — task/checkpoint status ledger.
- `CURRENT_STATE.md` — this handoff.
- `apps/web` — Next.js App Router foundation and HTTP health endpoint.
- `apps/worker` — Node.js Worker foundation and health contract.
- `packages/shared` — validated environment, Macau time, correlation ID and structured logging utilities.
- Root pnpm/Turborepo, TypeScript, Tailwind, ESLint, Prettier, Vitest and Playwright tooling.
- `.github/workflows/ci.yml` — install and full verification workflow.

Database schema and migrations do not exist yet; they begin in T-003.

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

| Item                                | Status                         | Evidence                                                                          |
| ----------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| P0 v1.2 scope specification         | Complete                       | `docs/P0_v1.2.md`; commit `3d36fe66d7ab333c01accd208c59a5475f0c1171`              |
| Initial implementation backlog      | Superseded by expanded backlog | commit `d87bc1446daad55b0aa0bc0a2bee4cc8bdae34b1`                                 |
| Expanded T-001–T-032 plan           | Complete                       | `docs/IMPLEMENTATION_TASKS.md`; commit `3dcb391ac9a90d0918bb3e0a94fcd0a64d1fb617` |
| Persistent context/checkpoint files | Complete                       | `AGENTS.md`, `CURRENT_STATE.md`, `tasks.md`                                       |
| T-001 engineering baseline          | Complete                       | Web/Worker workspace, health tests, CI and full verification in this Task commit  |
| T-002 config and observability      | Complete                       | Zod env validation, Macau time helpers, correlation IDs and redacted JSON logging |

## Active Checkpoint

`CP-01 — Project Foundation`

## Active Task

`T-003 — PostgreSQL／Prisma 核心 Schema` is next.

T-002 added Zod environment validation, UTC/Asia-Macau time helpers, structured logging, correlation IDs and recursive secret redaction. Web health responses now propagate request correlation IDs, and Worker startup emits a job-correlated structured record. T-003 may introduce Prisma models and migrations; preserve these shared contracts.

## Verification Baseline

- `pnpm install --frozen-lockfile` passes using pnpm 11.19.0.
- `pnpm verify` passes after loading `.env`: formatting, ESLint, TypeScript, 20 Vitest tests and production builds for Shared, Web and Worker.
- Next.js production build exposes `/`, `/_not-found` and `/api/health`; Worker compiles to `dist/`.
- `/api/health` returns the health contract with an `x-correlation-id` response header; Worker startup emits a structured `worker.ready` record with a job correlation ID.
- Playwright configuration and a browser smoke test exist. Chromium could not be downloaded in this managed environment because the endpoint returned a zero-byte archive; run `pnpm exec playwright install chromium && pnpm test:e2e` on CI or a normal development host.

## Known Risks

- The live Macau Airport HTML structure has not been captured or tested. Address this in T-006 with saved fixtures; do not mix the investigation into T-001.
- Threads/Facebook credentials and production authorization are not yet validated. They are not required before T-017/T-018.
- Exact production VPS details are intentionally deferred to T-031.

## Next Exact Action

Start T-003 on a new branch from the completed T-002 commit. Mark T-003 `[-]` in `tasks.md`, implement the Prisma schema and initial migration test-first, and update this file with verification evidence.

```text
feat: add core prisma schema
```

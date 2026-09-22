# FlightCheck Current State

> Updated: 2026-09-22  
> Branch: `main`  
> Baseline commit inspected: `3dcb391ac9a90d0918bb3e0a94fcd0a64d1fb617`

## Project Phase

Planning complete; implementation has not started.

The repository currently contains documentation only:

- `docs/P0_v1.2.md` — frozen P0 product specification.
- `docs/IMPLEMENTATION_TASKS.md` — detailed T-001 through T-032 backlog and CP-01 through CP-06 gates.
- `AGENTS.md` — persistent implementation and handoff rules.
- `tasks.md` — task/checkpoint status ledger.
- `CURRENT_STATE.md` — this handoff.

There is no application source, package manifest, database schema, migration, CI workflow or executable test suite yet. Any future session must not assume those artifacts already exist.

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

| Item | Status | Evidence |
|---|---|---|
| P0 v1.2 scope specification | Complete | `docs/P0_v1.2.md`; commit `3d36fe66d7ab333c01accd208c59a5475f0c1171` |
| Initial implementation backlog | Superseded by expanded backlog | commit `d87bc1446daad55b0aa0bc0a2bee4cc8bdae34b1` |
| Expanded T-001–T-032 plan | Complete | `docs/IMPLEMENTATION_TASKS.md`; commit `3dcb391ac9a90d0918bb3e0a94fcd0a64d1fb617` |
| Persistent context/checkpoint files | Complete | `AGENTS.md`, `CURRENT_STATE.md`, `tasks.md` |

## Active Checkpoint

`CP-01 — Project Foundation`

## Active Task

None. The next Task is `T-001 — Repository 與工程基線`.

T-001 must create the pnpm workspace, Next.js Web app, Worker package, TypeScript/Tailwind/tooling, health checks, environment example, README and the first runnable verification suite. Follow the exact acceptance and commit contract in `docs/IMPLEMENTATION_TASKS.md`.

## Verification Baseline

- Repository tree inspected recursively at commit `3dcb391ac9a90d0918bb3e0a94fcd0a64d1fb617`.
- Only the two documentation files existed before this context commit.
- No build, lint, typecheck or test command exists yet; establishing them is part of T-001.

## Known Risks

- The live Macau Airport HTML structure has not been captured or tested. Address this in T-006 with saved fixtures; do not mix the investigation into T-001.
- Threads/Facebook credentials and production authorization are not yet validated. They are not required before T-017/T-018.
- Exact production VPS details are intentionally deferred to T-031.

## Next Exact Action

Create an isolated implementation branch/worktree for T-001, mark T-001 `[-]` in `tasks.md`, scaffold the documented workspace, verify all T-001 commands, update this file with results and commit using:

```text
chore: bootstrap flightcheck workspace
```

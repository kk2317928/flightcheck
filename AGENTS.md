# FlightCheck Agent Instructions

## Purpose

FlightCheck is a personal Air Macau (`NX`) flight-status and statistics system. P0 monitors Macau International Airport public data, stores its own history, calculates punctuality/cancellation statistics, and publishes confirmed cancellations plus a daily summary to Threads and Facebook.

The authoritative product scope is `docs/P0_v1.2.md`. The authoritative detailed backlog is `docs/IMPLEMENTATION_TASKS.md`. Do not add P1 ideas to P0 without an explicit scope decision.

## Mandatory Context Loading

At the beginning of every implementation session, read these files in order:

1. `AGENTS.md`
2. `CURRENT_STATE.md`
3. `tasks.md`
4. The active Task section in `docs/IMPLEMENTATION_TASKS.md`
5. Relevant sections of `docs/P0_v1.2.md`
6. Files and tests named by the active Task

Do not re-read the entire repository when `CURRENT_STATE.md` accurately identifies the active Task and affected areas. Expand inspection only when the recorded state is stale, contradictory, or insufficient.

## Current Architecture Contract

The planned repository boundaries are:

```text
apps/web/              Next.js public site, Admin and route handlers
apps/worker/           persistent scheduler and background jobs
packages/db/           Prisma schema, migrations, seed and DB client
packages/domain/       status, statistics and scheduling rules
packages/flight-source/ airport adapter, parser and fixtures
packages/social/       templates and publisher adapters
packages/shared/       configuration, time, logging and shared types
tests/acceptance/      P0 acceptance scenarios A01-H10
docs/operations/       deployment and recovery runbooks
```

Until T-001 creates this structure, treat it as the target rather than existing code.

## Non-Negotiable Domain Rules

- Store timestamps in UTC; resolve service day, schedules and display using `Asia/Macau`.
- Preserve flight numbers as strings, including suffixes such as `NX862D`.
- Keep operational status separate from performance status.
- Cancellation requires two consecutive explicit CANCELLED observations. A missing row is never a cancellation.
- A recovered confirmed cancellation becomes RECOVERED.
- Statistics are recalculated from FlightInstance data, not incremented counters.
- Each confirmed cancelled flight creates at most one `CANCELLED:{flight_instance_id}` SocialEvent.
- Publish a cancellation at `MAX(cancel_confirmed_at, start_of_scheduled_departure_hour)` and re-check status immediately before publishing.
- Threads and Facebook outcomes are independent. Never retry a platform that already succeeded.
- Daily summary idempotency is `DAILY_SUMMARY:{date}` and automatic publishing requires COMPLETE data quality.
- External flight data and social platforms must remain behind adapters.
- Never persist or log raw passwords, session tokens or social access tokens.

## Development Workflow

1. Work on exactly one Task unless `tasks.md` explicitly marks Tasks as parallel-safe.
2. Before implementation, set the Task to `[-]` in `tasks.md` and update `CURRENT_STATE.md`.
3. Use test-first development for behavior: failing test, minimal implementation, refactor, full relevant suite.
4. Keep domain rules out of UI components and route handlers.
5. Run the Task's verification commands plus repository-wide lint, typecheck, tests and build when available.
6. Update documentation in the same Task when commands, environment, schema or behavior changes.
7. Update `CURRENT_STATE.md` with evidence, decisions, risks and the exact next action.
8. Mark the Task `[x]` only after verification, then create one focused commit.
9. At a Checkpoint exit, run the full acceptance subset, update both state files, and create the planned tag only after all gates pass.

## Git Rules

- Default branch: `main`.
- Use a feature branch or isolated worktree for implementation Tasks; do not develop directly on `main` unless explicitly requested.
- Preserve unrelated user changes.
- One independently testable Task equals one commit; use the commit message listed in `docs/IMPLEMENTATION_TASKS.md` unless the change requires a clearer equivalent.
- Never rewrite published history, force-push, or delete branches/tags without explicit approval.
- Do not claim completion before fresh verification evidence.

## State File Responsibilities

`CURRENT_STATE.md` is a concise handoff, not a diary. Keep only the current architecture state, latest completed Task, active Task, verification evidence, blockers, decisions and next exact action.

`tasks.md` is the status ledger. Keep Task IDs, Checkpoint gates and status markers synchronized with actual commits. Detailed requirements remain in `docs/IMPLEMENTATION_TASKS.md`; do not fork or silently alter them in `tasks.md`.

## Stop Conditions

Stop and request a decision only when:

- a proposed change conflicts with P0 v1.2;
- the live airport source requires Playwright, a paid API, or an unplanned legal/technical workaround;
- a migration may destroy or irreversibly reinterpret stored history;
- social publishing could duplicate a real post or expose credentials;
- required credentials, external authorization or production access are unavailable;
- baseline tests fail before the Task's changes.

Ordinary implementation choices that fit the documented architecture do not require repeated confirmation.

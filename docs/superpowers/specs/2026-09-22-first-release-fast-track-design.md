# FlightCheck First Release Fast Track Design

> Date: 2026-09-22  
> Status: Approved  
> Approved: 2026-09-22  
> Product authority: `docs/P0_v1.2.md`

## 1. Purpose

FlightCheck has completed the engineering foundation, authentication, airport
source adapter, persistence, status engine, and scheduled flight-sync worker
through T-010. The original plan waits for every P0 subsystem before production
release. That sequence delays useful public delivery even though the core flight
data pipeline is already working.

The first release will therefore deliver the smallest production-safe product
that continuously collects Air Macau flight data, calculates truthful basic
statistics, exposes public flight information, and can be operated on a VPS.
Social publishing and the complete administration suite remain part of P0 but
will ship after the first public release.

## 2. Success Criteria

The first release is ready when:

- the Worker automatically synchronizes departures and arrivals every five
  minutes and recovers safely after restart;
- the site displays current Air Macau flights, cancellation information, and
  basic punctuality/cancellation statistics;
- users can open an individual flight page with stored history;
- an authenticated administrator can inspect sync health and manually trigger a
  sync without SSH;
- PostgreSQL data has a tested backup and restore procedure;
- Web, Worker, and PostgreSQL run through Docker Compose on the production VPS;
- CI, production smoke tests, and essential acceptance scenarios pass.

Threads and Facebook credentials, templates, publishing, retries, and daily
social summaries are explicitly not first-release blockers.

## 3. Scope

### 3.1 First-release scope

1. Statistics calculation from `FlightInstance` data, including daily totals,
   cancellation rate, on-time rate, delay distribution, and data-quality state.
2. Daily settlement and deterministic recalculation for historical days.
3. Public read API for summary, flight list, flight details, history, and
   cancellations.
4. Responsive public pages for the daily summary, flights, cancellations, and
   flight details.
5. Minimum operational Admin pages for flights, ScrapeRuns, sync health, and a
   protected manual-sync action.
6. Worker startup recovery, schedule registration, graceful shutdown, and
   observable heartbeat.
7. Database backup/restore commands and a production runbook.
8. Docker Compose production packaging, migration procedure, deployment, and
   smoke test.

### 3.2 Deferred to the post-launch P0 increment

- social template management;
- cancellation `SocialEvent` creation and publishing orchestration;
- Threads and Facebook adapters;
- daily social summary events;
- Admin Social, Templates, and Settings pages;
- nonessential Admin analytics and maintenance conveniences;
- broad fault-injection coverage and the 24-hour soak test;
- long-term retention automation beyond the initial backup requirement.

Deferral does not remove these items from `docs/P0_v1.2.md` or the T-001–T-032
backlog. It changes only which work blocks the first production release.

## 4. Delivery Structure

The fast track is divided into four release milestones:

### FR-01 — Truthful statistics

Complete the existing T-011 through T-013 domain work. Statistics remain
recalculated from stored `FlightInstance` data. A date with incomplete source
coverage must be shown as incomplete and must not be presented as a trustworthy
final daily result.

### FR-02 — Public product

Complete the public portions of T-020 through T-022 and the responsive,
accessible public acceptance subset from T-026. The Read API is the boundary
between UI and domain/database logic. Server components and route handlers must
not independently reproduce status or statistics rules.

### FR-03 — Minimum operations

Implement only the launch-critical portions of T-023, T-024, T-027, and T-028:
flight/ScrapeRun visibility, protected manual sync, worker recovery and
heartbeat, and database backup/restore. Deferred Admin functions remain listed
under their original tasks and cannot be marked complete until their full
acceptance criteria pass.

### FR-04 — Deploy and release

Complete T-031 and the launch-critical production smoke subset of T-032. Create
a separate first-release tag after CI, migration, backup/restore, restart
recovery, public route, Admin authentication, sync, and statistics smoke tests
all pass. The final P0 release tag remains reserved for the complete P0 gate.

## 5. Architecture and Data Flow

No new subsystem or replacement stack is introduced.

1. `apps/worker` fetches Macau Airport boards and persists observations through
   the existing flight-source and DB boundaries.
2. `packages/domain` calculates status and statistics without depending on
   Next.js or Prisma.
3. `packages/db` provides read models and atomic statistics persistence.
4. `apps/web` reads those models through server-side query services and exposes
   public pages plus protected Admin operations.
5. Docker Compose runs Web, Worker, and PostgreSQL as separate services.

The public UI may display the latest successful data timestamp and an explicit
incomplete-data warning. It must never convert a failed scrape into a zero-flight
day or silently present partial statistics as complete.

## 6. Operational and Error Behaviour

- A failed directional scrape remains isolated and visible through its
  `ScrapeRun`.
- Public pages use the most recent persisted data and display freshness and
  quality state rather than failing the entire site.
- Manual sync uses the same global lease and sync use case as scheduled work;
  it cannot create an overlapping second implementation path.
- Worker restart recovery finds unfinished work according to T-027 policy and
  does not infer cancellations from missing rows.
- Deployment stops if migration, health checks, or smoke tests fail.
- Backup success is not assumed from file creation alone; one clean restore
  drill is required before release.

## 7. Verification Strategy

Each fast-track milestone keeps test-first development and the existing full
repository verification gate. Release evidence must include:

- fixed-dataset statistics tests and Macau-time boundary tests;
- API and UI tests for complete, partial, failed, and empty states;
- Admin authorization and manual-sync overlap tests;
- Worker restart and recovery tests;
- fresh `pnpm verify` success;
- clean-database migration and seed;
- backup and restore drill;
- Docker Compose health checks and production smoke tests.

Social acceptance scenarios are not required for the first-release tag, but no
existing social-domain rule may be weakened or removed.

## 8. Task and Checkpoint Policy

`tasks.md` will gain a clearly separated First Release Fast Track section. It
will reference original task IDs and track only launch-critical slices. Original
tasks remain incomplete until all of their detailed acceptance criteria pass.
This prevents the accelerated release from falsely claiming completion of the
full P0 backlog.

The release sequence is:

1. close and tag CP-02;
2. deliver FR-01 statistics;
3. deliver FR-02 public product;
4. deliver FR-03 minimum operations;
5. deliver FR-04 deployment and smoke verification;
6. create a first-release tag;
7. resume deferred social and full Admin work toward the final P0 tag.

## 9. Release Naming

The accelerated deployment is the first public release, not completion of P0
v1.2. Its tag should use a distinct prerelease name such as
`first-release-v0.1.0`. The existing `p0-v1.2.0` tag remains reserved for the
complete CP-01 through CP-06 acceptance gate.

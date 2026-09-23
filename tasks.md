# FlightCheck Task Ledger

> Detailed requirements and acceptance criteria: `docs/IMPLEMENTATION_TASKS.md`  
> Product authority: `docs/P0_v1.2.md`  
> Status: `[ ]` not started · `[-]` active · `[x]` verified · `[!]` blocked

## CP-01 — Project Foundation

- [x] T-001 Repository 與工程基線
- [x] T-002 環境設定、時間與可觀測性基礎
- [x] T-003 PostgreSQL／Prisma 核心 Schema
- [x] T-004 Admin 身分驗證、Session 與 Audit

Checkpoint gate:

- [x] Fresh setup follows README successfully
- [x] Database migration and seed pass
- [x] Admin login/logout, protected routes and audit pass
- [ ] Tag `cp-01-foundation`

## CP-02 — Flight Acquisition & Status

- [x] T-005 Flight Source Contract 與 NormalizedFlight
- [x] T-006 MacauAirport HTTP Client 與 Parser Fixtures
- [x] T-007 Parser、機場詞典與狀態正規化
- [x] T-008 Flight Persistence 與變更歷史
- [x] T-009 Status Engine
- [x] T-010 Flight Sync Use Case 與 Worker

Checkpoint gate:

- [x] Acceptance A01–A12 and B01–B12 pass
- [x] Two fixture syncs prove CANCEL_PENDING → CANCELLED
- [x] Replaying identical data creates no duplicate instance/snapshot
- [x] Tag `cp-02-flight-engine`

## First Release Fast Track

> The original T-001–T-032 backlog remains authoritative. Fast Track entries
> track only the slices that block `first-release-v0.1.0`; an original Task is
> complete only after all of its detailed acceptance criteria pass.

- [-] FR-01 Truthful statistics — T-011 through T-013
- [ ] FR-02 Public product — T-020 through T-022 and public T-026 acceptance
- [ ] FR-03 Minimum operations — launch-critical T-023, T-024, T-027 and T-028
- [ ] FR-04 Deploy and release — T-031 and launch-critical T-032 smoke gate

First-release gate:

- [ ] Statistics, quality and settlement checkpoint passes
- [ ] Public dashboard, flight details, history and cancellations are usable
- [ ] Minimum Admin operations, restart recovery and backup/restore pass
- [ ] Docker deployment and production smoke pass
- [ ] Tag `first-release-v0.1.0`

## CP-03 — Statistics

- [x] T-011 Statistics Engine
- [x] T-012 Data Quality 與 Monitoring Gap
- [ ] T-013 Daily Settlement 與重算

Checkpoint gate:

- [ ] Fixed dataset matches manual calculations
- [ ] Acceptance C01–C12 passes
- [ ] Fake-clock boundaries at 23:30, 00:05 and 06:00 pass
- [ ] Tag `cp-03-statistics`

## CP-04 — SNS Pipeline

- [ ] T-014 Social Template Engine
- [ ] T-015 Cancellation SocialEvent 建立
- [ ] T-016 Social Publisher Orchestrator
- [ ] T-017 Threads Publisher Adapter
- [ ] T-018 Facebook Publisher Adapter
- [ ] T-019 Daily Summary Event

Checkpoint gate:

- [ ] Acceptance D01–D14 and E01–E10 passes
- [ ] Mock platform success, isolated failure, timeout and ambiguous result pass
- [ ] Template edits do not mutate historical event content
- [ ] Tag `cp-04-social`

## CP-05 — Public Site & Admin

- [ ] T-020 Read API 與查詢層
- [ ] T-021 公開首頁
- [ ] T-022 航班詳情、歷史與取消頁
- [ ] T-023 Admin Dashboard 與 Flights
- [ ] T-024 Admin Statistics 與 Scraper
- [ ] T-025 Admin Social、Templates 與 Settings
- [ ] T-026 UI Accessibility 與 Responsive 驗收

Checkpoint gate:

- [ ] Acceptance F01–F16 and G01–G12 passes
- [ ] Public pages remain public; every Admin route is protected
- [ ] Routine sync/recalculate/social/template/settings operations require no SSH
- [ ] Tag `cp-05-ui`

## CP-06 — Reliability, Acceptance & Deployment

- [ ] T-027 Worker 啟動恢復與排程總裝
- [ ] T-028 Retention、備份與維護任務
- [ ] T-029 Security 與故障注入
- [ ] T-030 完整 Acceptance Suite
- [ ] T-031 Docker 與 Production Deployment
- [ ] T-032 Production Smoke Test 與交接

Checkpoint gate:

- [ ] Acceptance A01–H10 signed off
- [ ] CI, production build, migration, backup/restore and restart recovery pass
- [ ] 24-hour soak test passes
- [ ] Release tag `p0-v1.2.0`

## Dependency and Parallelism Rules

- Default execution order is T-001 through T-032.
- T-014 may run in parallel with T-011–T-013 after CP-01.
- T-017 and T-018 may run in parallel after T-016.
- T-021 and T-022 may run in parallel after T-020.
- No UI Task may invent domain logic missing from its prerequisite service.
- Do not cross a Checkpoint gate with any failed or unverified required item.

## Task Completion Record Template

When marking a Task `[x]`, add its durable evidence to `CURRENT_STATE.md` using:

```markdown
### T-NNN — Task name

- Commit: `<sha>`
- Verification: `<command>` → `<result>`
- Decisions: `<only durable architecture/domain decisions>`
- Follow-up: `<next exact Task or blocker>`
```

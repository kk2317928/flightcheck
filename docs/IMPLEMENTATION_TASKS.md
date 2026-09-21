# FlightCheck — Implementation Tasks & Checkpoints

> P0 v1.2
> Repository：kk2317928/flightcheck

## 原則
每個獨立 Task 完成即 Git commit；每個 Checkpoint 測試通過才進下一階段；不任意擴充 P0；外部來源／SNS 經 Adapter；Status/Statistics/SNS 規則不得在 UI 重複實作；SNS 必須 idempotent。

## CP-01 Project Foundation
- I-001 Next.js Bootstrap
- I-002 PostgreSQL + Prisma
- I-003 Auth / Admin Session
Exit：build、migration、admin login 通過。

## CP-02 Flight Acquisition & Status
- I-004 MacauAirportAdapter
- I-005 Parser Fixtures + Tests
- I-006 Airport Dictionary
- I-007 Flight Persistence
- I-008 Status Engine
- I-009 Flight Sync Worker
Exit：live/fixture 可建立正確 NX FlightInstance 並通過 Status tests。

## CP-03 Statistics
- I-010 Statistics Engine
- I-011 Daily Settlement
Exit：固定 dataset 得到預期 total/cancelled/cancellation-rate/on-time-rate/average-delay。

## CP-04 SNS
- I-012 Social Template Engine
- I-013 Cancellation SocialEvent
- I-014 Scheduled Publisher
- I-015 Threads Adapter
- I-016 Facebook Adapter
- I-017 Daily Summary
Exit：mock adapters 驗證取消及每日貼文，且不重複發布。

## CP-05 Public + Admin UI
- I-018 Public Homepage
- I-019 Flight Detail
- I-020 History / Cancellations
- I-021 Admin Dashboard
- I-022 Admin Flights
- I-023 Admin Statistics
- I-024 Admin Scraper
- I-025 Admin Social
- I-026 Admin Templates
- I-027 Admin Settings
Exit：Desktop + mobile 核心流程可操作，日常監控不需 SSH。

## CP-06 Reliability / Acceptance / Deployment
- I-028 Job Recovery / Lock
- I-029 Monitoring / Retention
- I-030 Full Acceptance Tests
- I-031 Docker / Production Deployment
- I-032 Production Smoke Test
Exit：P0 可長期無人值守運作。

## Acceptance Matrix
A Scraper：Departures、Arrivals、NX filter、suffix flight、CANCELLED、DELAY UNTIL、TOOK OFF、Unknown Airport/Status、Source Updated、Partial、航班消失不等於取消。

B Flight：Scheduled、On-time、>=15 Delay、>=60 Severe、提早起飛、首次取消 Pending、二次確認、reset、RECOVERED、regression protection、Arrived terminal、跨午夜。

C Statistics：Total、Departure/Arrival、Cancelled、Cancellation Rate、On-time Rate、Average Delay、Pending、Recovered、Unknown、Data Quality。

D Cancellation SNS：二次確認建 Event、一班一 Event、提前取消等原定時段、時段內/逾時立即發、Late Notice、平台獨立、發布前恢復不發、Crash 不重複、Retry。

E Daily SNS：23:30、immutable payload、Total/Cancelled/Rate、COMPLETE 自動發、DEGRADED Block、每日一 Event、模板歷史、期限內補發。

F Admin：Login、Dashboard、Search、History、Snapshot、Statistics、Recalculate、ScrapeRun、Manual Sync、SNS Posts/Retry、Template Edit/Preview/Validation、Settings、Audit。

G Frontend：Total、Cancelled、Cancellation Rate、On-time Rate、Flight List/Filters/Detail、History、Cancellations、Quality Warning、Mobile、Last Updated。

H Reliability：Job Lock、Heartbeat、HTTP Timeout、Monitoring Gap、Restart Recovery、Social/Daily idempotency、Retention、Session Security、Sensitive Token 不進 DB。

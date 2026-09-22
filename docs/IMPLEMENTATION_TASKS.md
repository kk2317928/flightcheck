# FlightCheck — Implementation Tasks & Checkpoints

> 對應規格：澳門航空航班動態統計網站 P0 v1.2（Final Scope Freeze）  
> Repository：`kk2317928/flightcheck`  
> 文件狀態：Ready for Implementation  
> 時區：`Asia/Macau`

## 1. 執行規則

- 按 Task 編號順序實作；只有明確標示可平行的 Task 才能並行。
- 每個 Task 必須包含：程式、測試、必要文件與一次獨立 Git commit。
- 每個 Checkpoint 完成後執行完整驗證，更新 `CURRENT_STATE.md` 與本文件狀態，再開始下一階段。
- 外部航班來源只能透過 Flight Data Adapter；Threads／Facebook 只能透過 Social Publisher Adapter。
- Status、Statistics、SNS 排程與防重複規則只能存在於 domain/service 層，不得在 UI 重寫。
- 所有時間入庫使用 UTC；解析、排程、統計日界與 UI 顯示固定使用 `Asia/Macau`。
- 不把 access token、password、session raw token 寫入資料庫或 log。
- P0 不加入付費航班 API、Playwright、多航空公司、公開會員、AI 貼文或即時 WebSocket。

## 2. 建議目錄邊界

```text
apps/
  web/                         # Next.js 公開站、Admin、Route Handlers
  worker/                      # 常駐排程、同步、SNS、維護工作
packages/
  db/                          # Prisma schema、migration、seed、DB client
  domain/                      # 狀態、統計、事件排程等純規則
  flight-source/               # Airport adapter、parser、fixtures
  social/                      # Template engine、publisher adapters
  shared/                      # env、Zod schema、logger、time、共用型別
tests/
  acceptance/                  # 對應 A01～H10
docs/
  operations/                  # 部署、備份、恢復、故障處理
```

## 3. 任務狀態標記

- `[ ]` 未開始
- `[-]` 進行中
- `[x]` 已完成且驗收通過
- `[!]` 阻塞；必須在 `CURRENT_STATE.md` 記錄原因及下一步

---

# CP-01 — Project Foundation

## T-001 Repository 與工程基線

**依賴：** 無  
**交付：** pnpm workspace、Next.js App Router、Worker package、TypeScript、Tailwind、ESLint、Prettier、Vitest、Playwright、`.env.example`、`AGENTS.md`、`CURRENT_STATE.md`、README。  
**驗收：** `pnpm install --frozen-lockfile`、lint、typecheck、unit test、production build 全部成功；Web 與 Worker 有健康檢查。  
**Commit：** `chore: bootstrap flightcheck workspace`

## T-002 環境設定、時間與可觀測性基礎

**依賴：** T-001  
**交付：** Zod env validation、UTC／Asia-Macau time helper、結構化 logger、request/job correlation id、敏感欄位遮罩。  
**驗收：** 缺少必要 env 時 fail fast；澳門跨日測試正確；token/password 不出現在 log snapshot。  
**Commit：** `feat: add validated configuration and time utilities`

## T-003 PostgreSQL／Prisma 核心 Schema

**依賴：** T-001～T-002  
**交付：** P0 全部 model、enum、relation、index、unique constraint、初始 migration、seed。必須包括 FlightInstance 唯一識別、Snapshot hash、SocialEvent idempotency key、SocialPost `(social_event_id, platform)` unique、JobLock。  
**驗收：** 空資料庫可 migrate＋seed；重複 event／post 被 DB constraint 阻止；migration rollback／重建流程有文件。  
**Commit：** `feat(db): add initial flightcheck schema`

## T-004 Admin 身分驗證、Session 與 Audit

**依賴：** T-003  
**交付：** Admin Email/Password、Argon2id、HttpOnly Secure SameSite Cookie、session raw token hash、到期／撤銷、登入 rate limit、admin middleware、AdminAuditLog。  
**驗收：** F01、F16、H09；未登入不能進入 Admin／mutation API；logout 後 session 無法重用。  
**Commit：** `feat(auth): add secure admin sessions and audit log`

### CP-01 Exit Gate

- [ ] 全新環境可依 README 啟動。
- [ ] DB migration／seed 成功。
- [ ] Admin 登入、登出、保護路由及 audit 測試通過。
- [ ] 建立 `cp-01-foundation` tag。

---

# CP-02 — Flight Acquisition & Status

## T-005 Flight Source Contract 與 NormalizedFlight

**依賴：** CP-01  
**交付：** `FlightSourceAdapter`、`RawAirportFlight`、`NormalizedFlight`、Warning、fetch result contract；flight number 保持字串並接受 `NX862D`。  
**驗收：** contract test 覆蓋完整、partial、timeout、malformed response；domain 不引用 HTML parser。  
**Commit：** `feat(source): define flight source contracts`

## T-006 MacauAirport HTTP Client 與 Parser Fixtures

**依賴：** T-005  
**交付：** Departures／Arrivals HTTP client、timeout、重試上限、sourceUpdatedAt／fetchedAt；保存去識別化 HTML fixtures。  
**驗收：** A01、A02、A10、A11、H03；HTTP failure 不會把舊航班判成取消。  
**Commit：** `feat(source): add macau airport client and fixtures`

## T-007 Parser、機場詞典與狀態正規化

**依賴：** T-005～T-006  
**交付：** Departures／Arrivals parser、NX filter、airport dictionary、status／time／date resolver、deduplicator；未知資料產生 Warning，不猜測。  
**驗收：** A03～A09、A12；包含 cancelled、delay-until、took-off、字母後綴、跨午夜、未知機場／狀態、破損列。  
**Commit：** `feat(source): normalize macau airport flights`

## T-008 Flight Persistence 與變更歷史

**依賴：** T-003、T-007  
**交付：** Flight／FlightInstance upsert、可靠自然鍵、changed-only Snapshot hash、StatusHistory、warning persistence、transaction boundary。  
**驗收：** 相同 payload 重跑不新增 Snapshot；實質變更只新增一次；同日 arrival／departure 不誤合併。  
**Commit：** `feat(flights): persist instances snapshots and history`

## T-009 Status Engine

**依賴：** T-005、T-008  
**交付：** OperationalStatus 與 PerformanceStatus 純函式／service；15／60 分鐘門檻、提早起飛 delay=0、schedule variance、連續兩次取消、reset、RECOVERED、terminal regression protection。  
**驗收：** B01～B12；頁面消失不觸發取消；取消確認只接受連續且明確的 CANCELLED observation。  
**Commit：** `feat(domain): implement flight status engine`

## T-010 Flight Sync Use Case 與 Worker

**依賴：** T-006～T-009  
**交付：** 每 5 分鐘同步、JobLock、ScrapeRun、source health、monitoring gap、manual sync command/API、部分來源失敗處理。  
**驗收：** 重疊同步只執行一個；Departures 成功而 Arrivals 失敗時標記 partial 且保留資料；fixture 可建立正確 NX FlightInstance。  
**Commit：** `feat(worker): add resilient flight sync job`

### CP-02 Exit Gate

- [ ] A01～A12、B01～B12 全部通過。
- [ ] 以 fixture 執行兩輪同步，取消 Pending→Confirmed 正確。
- [ ] 重跑同一資料不產生重複 FlightInstance／Snapshot。
- [ ] 建立 `cp-02-flight-engine` tag。

---

# CP-03 — Statistics

## T-011 Statistics Engine

**依賴：** CP-02  
**交付：** 由 FlightInstance 全量重新 aggregate 的 daily statistics service；total、direction、determined／pending、on-time／delayed／severe、cancelled／unknown、rate、average delay、quality、cutoff。  
**驗收：** C01～C12；分母为 0 時回傳明確 null／N/A，不產生 NaN；取消仍計 total，pending 不進取消與準點率。  
**Commit：** `feat(statistics): implement daily aggregation engine`

## T-012 Data Quality 與 Monitoring Gap

**依賴：** T-010～T-011  
**交付：** COMPLETE／DEGRADED quality evaluator、來源缺口與最後成功時間、warning summary、daily cutoff evidence。  
**驗收：** 任一必要來源缺失、長時間無同步或 unresolved critical warning 時不會被標示 COMPLETE。  
**Commit：** `feat(statistics): add data quality evaluation`

## T-013 Daily Settlement 與重算

**依賴：** T-011～T-012  
**交付：** 23:30 snapshot、00:05 起每小時 settlement、PRELIMINARY／FINAL／FINAL_WITH_WARNINGS、06:00 deadline、manual recalculate，保存 cutoff／settledAt。  
**驗收：** 同一天重算採 upsert；FINAL 不被一般排程降級；晚到資料依規則更新並保留 audit。  
**Commit：** `feat(statistics): add daily settlement workflow`

### CP-03 Exit Gate

- [ ] 固定 dataset 的數字與人工計算一致。
- [ ] C01～C12 全部通過。
- [ ] 23:30、00:05、06:00 邊界以 fake clock 測試通過。
- [ ] 建立 `cp-03-statistics` tag。

---

# CP-04 — SNS Pipeline

## T-014 Social Template Engine

**依賴：** CP-01  
**可與 T-011～T-013 平行。**  
**交付：** CANCELLED／DAILY_SUMMARY 預設模板、approved variable registry、validation、preview、render；禁止未知變數與任意程式碼。  
**驗收：** F12～F14、E09；event 建立後模板修改不改既有 rendered content。  
**Commit：** `feat(social): add safe template engine`

## T-015 Cancellation SocialEvent 建立

**依賴：** T-009、T-014  
**交付：** confirmed cancellation hook／use case；一班一 event；`MAX(cancel_confirmed_at, start_of_scheduled_departure_hour)`；ARRIVAL_FALLBACK、late notice、immutable payload。  
**驗收：** D01～D08；idempotency key 為 `CANCELLED:{flight_instance_id}`；資料庫競態測試只留下單一 event。  
**Commit：** `feat(social): schedule cancellation events`

## T-016 Social Publisher Orchestrator

**依賴：** T-014～T-015  
**交付：** due event claim、發布前狀態再確認、CANCELLED_BEFORE_PUBLISH、逐平台 SocialPost、5／15／30 分鐘 retry、STUCK recovery、NEEDS_REVIEW。  
**驗收：** D09～D14、H06；Threads 成功／Facebook 失敗只重試 Facebook；模糊結果不盲目重發。  
**Commit：** `feat(social): add idempotent publishing workflow`

## T-017 Threads Publisher Adapter

**依賴：** T-016  
**交付：** Threads API adapter、credential validation、publish result（external id／URL）、rate limit／auth／timeout／ambiguous error normalization。  
**驗收：** contract tests 使用 mock server；所有 token 只來自 env／secret，DB 只存外部 post metadata。  
**Commit：** `feat(social): add threads publisher adapter`

## T-018 Facebook Publisher Adapter

**依賴：** T-016  
**可與 T-017 平行。**  
**交付：** Facebook Page API adapter，錯誤分類與輸出 contract 同 Threads。  
**驗收：** contract tests 使用 mock server；平台失敗完全隔離；token 不進 DB／log。  
**Commit：** `feat(social): add facebook publisher adapter`

## T-019 Daily Summary Event

**依賴：** T-013～T-014、T-016  
**交付：** 23:30 pre-sync→statistics→quality→immutable payload→event；`DAILY_SUMMARY:{date}`；DEGRADED 時 BLOCKED_DATA_QUALITY；停機後在允許期限內補建。  
**驗收：** E01～E10、H07；多 Worker／重啟／重跑都只有一個 daily event。  
**Commit：** `feat(social): add daily summary publishing`

### CP-04 Exit Gate

- [ ] D01～D14、E01～E10 全部通過。
- [ ] Mock Threads／Facebook 完整跑過成功、單平台失敗、timeout、ambiguous result。
- [ ] 確認修改模板不改歷史 event payload／rendered content。
- [ ] 建立 `cp-04-social` tag。

---

# CP-05 — Public Site & Admin

## T-020 Read API 與查詢層

**依賴：** CP-03  
**交付：** public／admin query services、Zod query schema、pagination、date／direction／status／flight filters、cache policy、資料品質欄位。  
**驗收：** 無資料、非法日期、大頁碼、`NX862D`、跨日查詢；Admin-only fields 不洩漏到 public response。  
**Commit：** `feat(api): add flight and statistics queries`

## T-021 公開首頁

**依賴：** T-020  
**交付：** 第一優先顯示總航班、取消數、取消率；另含準點率、平均延誤、最後更新、資料品質及當日航班列表／filters。  
**驗收：** G01～G06、G10～G12；mobile／desktop、loading／empty／degraded／error states。  
**Commit：** `feat(web): add public flight dashboard`

## T-022 航班詳情、歷史與取消頁

**依賴：** T-020  
**可與 T-021 平行。**  
**交付：** `/flights/[flight]`、`/history`、`/cancellations`；航班狀態、時間、方向、歷史趨勢與取消紀錄。  
**驗收：** G07～G09；航班號 URL 安全編碼、找不到資料、跨日同號班機不混淆。  
**Commit：** `feat(web): add flight detail and history pages`

## T-023 Admin Dashboard 與 Flights

**依賴：** T-004、T-010、T-020  
**交付：** dashboard、航班搜尋／詳情、StatusHistory、Snapshot、manual sync、最新 job／source health。  
**驗收：** F02～F05、F09；mutation 有 CSRF／origin protection、權限與 audit；手動同步不能繞過 JobLock。  
**Commit：** `feat(admin): add dashboard and flight operations`

## T-024 Admin Statistics 與 Scraper

**依賴：** T-013、T-023  
**交付：** daily statistics、quality／settlement、manual recalculate、ScrapeRun、warnings、monitoring gaps。  
**驗收：** F06～F08；重算二次確認並留 audit；partial／failed run 可被辨識。  
**Commit：** `feat(admin): add statistics and scraper operations`

## T-025 Admin Social、Templates 與 Settings

**依賴：** CP-04、T-023  
**交付：** event／post 列表與狀態、單平台 retry、NEEDS_REVIEW 操作、模板編輯／preview、允許的 operational settings。  
**驗收：** F10～F15；SUCCESS post 不可一般 retry；設定與模板 validation server-side 強制執行；所有 mutation 留 audit。  
**Commit：** `feat(admin): add social templates and settings`

## T-026 UI Accessibility 與 Responsive 驗收

**依賴：** T-021～T-025  
**交付：** keyboard／focus、semantic labels、table mobile treatment、色彩以外的狀態提示、共同 loading／empty／error pattern。  
**驗收：** G11；核心公開與 Admin 流程在指定 mobile／desktop viewport 通過 E2E 與 accessibility scan。  
**Commit：** `fix(ui): complete responsive accessibility pass`

### CP-05 Exit Gate

- [ ] F01～F16、G01～G12 全部通過。
- [ ] 公開頁面無需登入；Admin 全部受保護。
- [ ] 日常同步、重算、SNS retry、模板與設定操作不需 SSH。
- [ ] 建立 `cp-05-ui` tag。

---

# CP-06 — Reliability, Acceptance & Deployment

## T-027 Worker 啟動恢復與排程總裝

**依賴：** CP-04  
**交付：** scheduler registry、heartbeat；啟動時清 expired locks、立即 sync、處理 due events、PENDING／FAILED／STUCK posts、漏跑 daily summary、昨日未 FINAL 統計與 monitoring gap。  
**驗收：** H01、H02、H04、H05；在每個 job 關鍵點強制終止後重啟，無漏執行與無重複 SNS。  
**Commit：** `feat(worker): add startup recovery and scheduler`

## T-028 Retention、備份與維護任務

**依賴：** T-003、T-027  
**交付：** 03:30 cleanup；Snapshot 180 日、ScrapeRun 90 日，其餘指定資料永久；DB backup／restore runbook。  
**驗收：** H08；只刪到期目標資料，不破壞 relation／audit／social history；在測試 DB 完成一次 restore drill。  
**Commit：** `feat(ops): add retention and database recovery`

## T-029 Security 與故障注入

**依賴：** T-004、T-016～T-018、T-025  
**交付：** dependency／secret scan、headers、rate limits、CSRF／origin、input boundaries、log redaction、DB outage／source timeout／platform timeout tests。  
**驗收：** H03、H09、H10；高風險 finding 清零；暫時性外部故障可恢復且不重複發布。  
**Commit：** `test: add security and failure injection coverage`

## T-030 完整 Acceptance Suite

**依賴：** T-026～T-029  
**交付：** `tests/acceptance` 對應 A01～H10、seeded scenario dataset、coverage mapping report。  
**驗收：** A01～H10 每項至少一個自動化測試或有明確人工驗收腳本；CI 全綠，無 skipped critical case。  
**Commit：** `test: complete p0 acceptance suite`

## T-031 Docker 與 Production Deployment

**依賴：** T-030  
**交付：** Web／Worker image、Docker Compose、PostgreSQL、healthcheck、migration job、reverse proxy／TLS 指引、secret／volume／backup／rollback runbook。  
**驗收：** 全新 VPS rehearsal 可部署；restart policy 正確；Web 與 Worker 獨立升級；rollback 不破壞 DB。  
**Commit：** `ops: add production docker deployment`

## T-032 Production Smoke Test 與交接

**依賴：** T-031  
**交付：** production smoke checklist、真實來源一次同步、Admin 操作、mock／安全測試事件、heartbeat／logs／backup 確認、P0 release notes。  
**驗收：** 首次同步可見 NX 航班；統計一致；不發測試貼文至正式帳號；24 小時 soak 無重複事件、lock stuck 或 monitoring gap。  
**Commit：** `docs: complete p0 production handoff`

### CP-06 Exit Gate

- [ ] A01～H10 全部簽核。
- [ ] CI、production build、migration、backup／restore、restart recovery 全部通過。
- [ ] 24 小時 soak test 通過。
- [ ] 建立 `p0-v1.2.0` release tag。

---

## 4. 全域 Definition of Done

每個 Task 只有在以下條件全部成立時才可標記 `[x]`：

1. 驗收條件已由自動化測試或明確人工證據覆蓋。
2. lint、typecheck、相關 unit／integration／E2E test 通過。
3. 沒有把規則複製到 UI、route handler 或平台 adapter。
4. migration、env、操作方式或行為變更已更新文件。
5. `CURRENT_STATE.md` 已記錄完成項目、測試命令、commit hash、下一 Task 與已知風險。
6. 已建立單一、可回退、訊息清楚的 Git commit。

## 5. 建議執行順序

```text
CP-01 Foundation
  → CP-02 Acquisition & Status
  → CP-03 Statistics
  → CP-04 SNS
  → CP-05 Public/Admin UI
  → CP-06 Reliability/Deployment
```

唯一建議平行區段：T-014 可在 CP-03 期間進行；T-017／T-018 可平行；T-021／T-022 可平行。其餘維持順序，以免 domain contract 尚未穩定便開始 UI 或 production integration。

## 6. 第一個執行批次

首次進入實作時只啟動 T-001。完成後依序執行 T-002、T-003、T-004，通過 CP-01 Exit Gate 才開始抓取真實航班資料。任何來源 HTML 結構不明問題，在 T-006 保存 fixture 並建立 parser test，不把臨時 selector 散落到 Worker 或 UI。

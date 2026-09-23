import Link from 'next/link';
import { DataQualityBanner } from '../components/data-quality-banner';
import { FlightTable } from '../components/flight-table';
import { StatCard } from '../components/stat-card';
import { getFlightQueryService } from '../lib/flights/query-runtime';
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string; direction?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const date =
    params.date ??
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Macau' }).format(
      new Date(),
    );
  const service = getFlightQueryService();
  const [summary, flights] = await Promise.all([
    service.getDailySummary(date),
    service.listFlights({
      date,
      direction: params.direction,
      page: 1,
      pageSize: 100,
    }),
  ]);
  const percent = (value: number | null) =>
    value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">AIR MACAU · NX</p>
        <h1>澳門航空航班動態</h1>
        <p>每日航班、取消與準點資訊，資料狀態清楚標示。</p>
        <nav aria-label="主要導覽">
          <Link href="/">今日航班</Link>
          <Link href="/history">歷史</Link>
          <Link href="/cancellations">取消航班</Link>
        </nav>
      </header>
      <form className="filters">
        <label>
          服務日期
          <input type="date" name="date" defaultValue={date} />
        </label>
        <label>
          方向
          <select name="direction" defaultValue={params.direction ?? ''}>
            <option value="">全部</option>
            <option value="DEPARTURE">出發</option>
            <option value="ARRIVAL">抵達</option>
          </select>
        </label>
        <button type="submit">查詢</button>
      </form>
      {summary ? (
        <>
          <DataQualityBanner
            quality={summary.dataQuality}
            updatedAt={summary.lastUpdatedAt}
          />
          <section className="stats" aria-label="每日統計">
            <StatCard label="總航班" value={summary.totalFlights} />
            <StatCard label="取消航班" value={summary.cancelledFlights} />
            <StatCard
              label="取消率"
              value={percent(summary.cancellationRate)}
            />
            <StatCard label="準點率" value={percent(summary.onTimeRate)} />
            <StatCard
              label="平均延誤"
              value={
                summary.averageDelayMinutes === null
                  ? 'N/A'
                  : `${summary.averageDelayMinutes} 分鐘`
              }
            />
          </section>
        </>
      ) : (
        <div className="empty-state">
          <strong>尚無資料</strong>
          <p>這一天尚未產生可信統計。</p>
        </div>
      )}
      <section>
        <div className="section-heading">
          <h2>航班列表</h2>
          <span>{flights.total} 班</span>
        </div>
        <FlightTable flights={flights.items} />
      </section>
    </main>
  );
}

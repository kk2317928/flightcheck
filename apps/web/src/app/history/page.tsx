import { FlightTable } from '../../components/flight-table';
import { getFlightQueryService } from '../../lib/flights/query-runtime';
export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const p = (await searchParams) ?? {};
  const result = await getFlightQueryService().listHistory({
    ...p,
    page: p.page ?? 1,
    pageSize: 50,
  });
  return (
    <main className="page-shell">
      <p className="eyebrow">FLIGHT HISTORY</p>
      <h1>航班歷史</h1>
      <p className="lede">按航班編號、日期與方向檢視已保存紀錄。</p>
      <FlightTable flights={result.items} />
    </main>
  );
}

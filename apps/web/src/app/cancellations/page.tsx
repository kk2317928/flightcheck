import { FlightTable } from '../../components/flight-table';
import { getFlightQueryService } from '../../lib/flights/query-runtime';
export default async function CancellationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const p = (await searchParams) ?? {};
  const result = await getFlightQueryService().listCancellations({
    ...p,
    page: p.page ?? 1,
    pageSize: 100,
  });
  return (
    <main className="page-shell">
      <p className="eyebrow">CANCELLATIONS</p>
      <h1>取消航班</h1>
      <p className="lede">只顯示已確認取消的航班。</p>
      <FlightTable flights={result.items} />
    </main>
  );
}

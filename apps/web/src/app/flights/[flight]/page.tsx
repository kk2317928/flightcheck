import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFlightQueryService } from '../../../lib/flights/query-runtime';

export default async function FlightDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ flight: string }>;
  searchParams?: Promise<{ date?: string; direction?: string }>;
}) {
  const route = await params;
  const query = (await searchParams) ?? {};
  const flight = await getFlightQueryService().getFlightDetails({
    flight: decodeURIComponent(route.flight),
    ...query,
  });
  if (!flight) notFound();
  return (
    <main className="page-shell">
      <Link href="/">← 返回航班列表</Link>
      <p className="eyebrow">FLIGHT DETAILS</p>
      <h1>{flight.flightNumber}</h1>
      <dl className="details">
        <div>
          <dt>服務日期</dt>
          <dd>{flight.serviceDate.toISOString().slice(0, 10)}</dd>
        </div>
        <div>
          <dt>方向</dt>
          <dd>{flight.direction === 'DEPARTURE' ? '出發' : '抵達'}</dd>
        </div>
        <div>
          <dt>航線</dt>
          <dd>
            {flight.originCode ?? '—'} → {flight.destinationCode ?? '—'}
          </dd>
        </div>
        <div>
          <dt>航班狀態</dt>
          <dd>{flight.operationalStatus}</dd>
        </div>
        <div>
          <dt>準點狀態</dt>
          <dd>{flight.performanceStatus}</dd>
        </div>
        <div>
          <dt>延誤</dt>
          <dd>
            {flight.delayMinutes === null
              ? 'N/A'
              : `${flight.delayMinutes} 分鐘`}
          </dd>
        </div>
      </dl>
    </main>
  );
}

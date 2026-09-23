import Link from 'next/link';
type Flight = {
  id: string;
  flightNumber: string;
  serviceDate: Date;
  direction: string;
  scheduledAt: Date;
  originCode: string | null;
  destinationCode: string | null;
  operationalStatus: string;
  performanceStatus: string;
  delayMinutes: number | null;
};
export function FlightTable({ flights }: { flights: Flight[] }) {
  if (!flights.length)
    return (
      <div className="empty-state">
        <strong>尚無資料</strong>
        <p>此篩選條件暫時沒有航班紀錄。</p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>航班</th>
            <th>方向</th>
            <th>航線</th>
            <th>時間</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {flights.map((f) => (
            <tr key={f.id}>
              <td>{f.serviceDate.toISOString().slice(0, 10)}</td>
              <td>
                <Link
                  href={`/flights/${encodeURIComponent(f.flightNumber)}?date=${f.serviceDate.toISOString().slice(0, 10)}&direction=${f.direction}`}
                >
                  {f.flightNumber}
                </Link>
              </td>
              <td>{f.direction === 'DEPARTURE' ? '出發' : '抵達'}</td>
              <td>
                {f.originCode ?? '—'} → {f.destinationCode ?? '—'}
              </td>
              <td>
                {f.scheduledAt.toLocaleTimeString('zh-MO', {
                  timeZone: 'Asia/Macau',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              <td>
                <span
                  className={`status status-${f.operationalStatus.toLowerCase()}`}
                >
                  {f.operationalStatus}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

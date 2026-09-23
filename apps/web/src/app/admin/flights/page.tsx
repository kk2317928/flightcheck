import { getDatabase } from '../../../lib/db';
export const dynamic = 'force-dynamic';
export default async function AdminFlightsPage() {
  const rows = await getDatabase().flightInstance.findMany({
    take: 100,
    orderBy: [{ serviceDate: 'desc' }, { scheduledAt: 'desc' }],
    include: { flight: { select: { flightNumber: true } } },
  });
  return (
    <main className="page-shell">
      <p className="eyebrow">ADMIN · FLIGHTS</p>
      <h1>航班管理</h1>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>航班</th>
              <th>方向</th>
              <th>狀態</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.serviceDate.toISOString().slice(0, 10)}</td>
                <td>{row.flight.flightNumber}</td>
                <td>{row.direction}</td>
                <td>
                  {row.operationalStatus} / {row.performanceStatus}
                </td>
                <td>
                  {row.updatedAt.toLocaleString('zh-MO', {
                    timeZone: 'Asia/Macau',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

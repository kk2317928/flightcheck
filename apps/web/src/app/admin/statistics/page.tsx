import { getDatabase } from '../../../lib/db';
import { OperationButtons } from '../operation-buttons';
export const dynamic = 'force-dynamic';
export default async function AdminStatisticsPage() {
  const rows = await getDatabase().dailyStatistic.findMany({
    take: 60,
    orderBy: { serviceDate: 'desc' },
  });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau',
  }).format(new Date());
  return (
    <main className="page-shell">
      <p className="eyebrow">ADMIN · STATISTICS</p>
      <h1>每日統計</h1>
      <OperationButtons serviceDate={today} />
      <div className="table-scroll mt-6">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>總航班</th>
              <th>品質</th>
              <th>結算</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.serviceDate.toISOString().slice(0, 10)}</td>
                <td>{row.totalFlights}</td>
                <td>{row.dataQuality}</td>
                <td>{row.settlementStatus}</td>
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

import { getDatabase } from '../../../lib/db';
export const dynamic = 'force-dynamic';
export default async function AdminScrapeRunsPage() {
  const rows = await getDatabase().scrapeRun.findMany({
    take: 100,
    orderBy: { startedAt: 'desc' },
  });
  return (
    <main className="page-shell">
      <p className="eyebrow">ADMIN · SOURCE HEALTH</p>
      <h1>同步狀態</h1>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>來源</th>
              <th>狀態</th>
              <th>開始</th>
              <th>航班</th>
              <th>警告</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.source}</td>
                <td>{row.status}</td>
                <td>
                  {row.startedAt.toLocaleString('zh-MO', {
                    timeZone: 'Asia/Macau',
                  })}
                </td>
                <td>{row.nxFlightCount}</td>
                <td>{row.warningCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

import Link from 'next/link';
export default function AdminPage() {
  return (
    <main className="page-shell">
      <p className="eyebrow">FLIGHTCHECK ADMIN</p>
      <h1>營運控制台</h1>
      <p className="lede">
        檢查航班、來源同步與每日統計，必要時執行受保護的人工操作。
      </p>
      <nav aria-label="管理功能">
        <Link href="/admin/flights">航班管理</Link>
        <Link href="/admin/scrape-runs">同步狀態</Link>
        <Link href="/admin/statistics">每日統計</Link>
      </nav>
    </main>
  );
}

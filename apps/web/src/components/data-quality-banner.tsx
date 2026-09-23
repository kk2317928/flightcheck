export function DataQualityBanner({
  quality,
  updatedAt,
}: {
  quality: string;
  updatedAt?: Date | null;
}) {
  const complete = quality === 'COMPLETE';
  return (
    <aside
      className={`quality-banner ${complete ? 'quality-complete' : 'quality-degraded'}`}
      role="status"
    >
      <strong>{complete ? '資料完整' : '資料不完整'}</strong>
      <span>
        {complete
          ? '統計已包含出發及抵達資料。'
          : '部分來源尚未完整，數字可能調整。'}
      </span>
      {updatedAt && (
        <span>
          最後更新：
          {updatedAt.toLocaleString('zh-MO', { timeZone: 'Asia/Macau' })}
        </span>
      )}
    </aside>
  );
}

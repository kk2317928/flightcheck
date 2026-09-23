export function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <article className="stat-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

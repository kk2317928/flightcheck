export type HealthStatus = Readonly<{
  service: 'web';
  status: 'ok';
}>;

export function getWebHealth(): HealthStatus {
  return { service: 'web', status: 'ok' };
}

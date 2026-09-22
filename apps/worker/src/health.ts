export type WorkerHealthStatus = Readonly<{
  service: 'worker';
  status: 'ok';
}>;

export function getWorkerHealth(): WorkerHealthStatus {
  return { service: 'worker', status: 'ok' };
}

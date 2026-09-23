import { getWorkerHealth } from './health.js';

const HEARTBEAT_INTERVAL_MS = 60_000;
const HEARTBEAT_TTL_MS = 120_000;

export interface WorkerHeartbeatStore {
  record(input: {
    ownerId: string;
    observedAt: Date;
    expiresAt: Date;
  }): Promise<void>;
}

export interface WorkerHeartbeat {
  stop(): void;
  waitForIdle(): Promise<void>;
}

export function startWorkerHeartbeat(dependencies: {
  store: WorkerHeartbeatStore;
  ownerId: string;
  now: () => Date;
  logger: {
    info(event: string, context?: Record<string, unknown>): void;
    error(event: string, context?: Record<string, unknown>): void;
  };
}): WorkerHeartbeat {
  let stopped = false;
  const active = new Set<Promise<void>>();

  function tick(): void {
    if (stopped) return;
    const observedAt = dependencies.now();
    const task = dependencies.store
      .record({
        ownerId: dependencies.ownerId,
        observedAt,
        expiresAt: new Date(observedAt.getTime() + HEARTBEAT_TTL_MS),
      })
      .then(() => {
        dependencies.logger.info('worker.heartbeat', {
          health: getWorkerHealth(),
          observedAt: observedAt.toISOString(),
        });
      })
      .catch((error: unknown) => {
        dependencies.logger.error('worker.heartbeat-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => active.delete(task));
    active.add(task);
  }

  tick();
  const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
    async waitForIdle() {
      await Promise.allSettled([...active]);
    },
  };
}

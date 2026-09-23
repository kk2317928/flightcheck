import { getMacauDateKey } from '@flightcheck/shared';

import type { FlightSyncInput, FlightSyncService } from './flight-sync.js';

const FIVE_MINUTES_MS = 300_000;

export interface FlightSyncSchedulerDependencies {
  service: FlightSyncService;
  now: () => Date;
  logger: {
    error(event: string, context?: Record<string, unknown>): void;
    info(event: string, context?: Record<string, unknown>): void;
  };
  runOnStart?: boolean;
}

export interface FlightSyncScheduler {
  stop(): void;
  waitForIdle(): Promise<void>;
}

export function startFlightSyncScheduler(
  dependencies: FlightSyncSchedulerDependencies,
): FlightSyncScheduler {
  let stopped = false;
  const activeRuns = new Set<Promise<void>>();

  function dispatch(trigger: FlightSyncInput['trigger']): void {
    if (stopped) return;
    const task = dependencies.service
      .run({
        serviceDate: getMacauDateKey(dependencies.now()),
        trigger,
      })
      .then((result) => {
        dependencies.logger.info('flight-sync.completed', {
          correlationId: result.correlationId,
          directions: result.directions,
          status: result.status,
          trigger,
        });
      })
      .catch((error: unknown) => {
        dependencies.logger.error('flight-sync.failed', {
          error: error instanceof Error ? error.message : String(error),
          trigger,
        });
      })
      .finally(() => {
        activeRuns.delete(task);
      });
    activeRuns.add(task);
  }

  if (dependencies.runOnStart !== false) dispatch('STARTUP');
  const interval = setInterval(() => dispatch('SCHEDULED'), FIVE_MINUTES_MS);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
    async waitForIdle() {
      await Promise.allSettled([...activeRuns]);
    },
  };
}

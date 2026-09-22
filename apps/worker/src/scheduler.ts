import { getMacauDateKey } from '@flightcheck/shared';

import type { FlightSyncInput, FlightSyncService } from './flight-sync.js';

const FIVE_MINUTES_MS = 300_000;

export interface FlightSyncSchedulerDependencies {
  service: FlightSyncService;
  now: () => Date;
  logger: {
    error(event: string, context?: Record<string, unknown>): void;
  };
}

export interface FlightSyncScheduler {
  stop(): void;
}

export function startFlightSyncScheduler(
  dependencies: FlightSyncSchedulerDependencies,
): FlightSyncScheduler {
  let stopped = false;

  function dispatch(trigger: FlightSyncInput['trigger']): void {
    if (stopped) return;
    void dependencies.service
      .run({
        serviceDate: getMacauDateKey(dependencies.now()),
        trigger,
      })
      .catch((error: unknown) => {
        dependencies.logger.error('flight-sync.failed', {
          error: error instanceof Error ? error.message : String(error),
          trigger,
        });
      });
  }

  dispatch('STARTUP');
  const interval = setInterval(() => dispatch('SCHEDULED'), FIVE_MINUTES_MS);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}

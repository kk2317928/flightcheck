import { getMacauDateKey } from '@flightcheck/shared';

import type { StatisticsService } from './statistics-service.js';

const TICK_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StatisticsSchedulerDependencies {
  service: StatisticsService;
  now: () => Date;
  logger: {
    error(event: string, context?: Record<string, unknown>): void;
    info(event: string, context?: Record<string, unknown>): void;
  };
}

export interface StatisticsScheduler {
  stop(): void;
  waitForIdle(): Promise<void>;
}

function scheduledServiceDate(now: Date): string | null {
  const macau = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const hour = macau.getUTCHours();
  const minute = macau.getUTCMinutes();
  if (hour === 23 && minute === 30) return getMacauDateKey(now);
  const isRetry = minute === 5 && hour >= 0 && hour <= 5;
  const isDeadline = hour === 6 && minute === 0;
  if (!isRetry && !isDeadline) return null;
  return getMacauDateKey(new Date(now.getTime() - DAY_MS));
}

export function startStatisticsScheduler(
  dependencies: StatisticsSchedulerDependencies,
): StatisticsScheduler {
  let stopped = false;
  const dispatchedSlots = new Set<string>();
  const activeRuns = new Set<Promise<void>>();

  function tick(): void {
    if (stopped) return;
    const now = dependencies.now();
    const serviceDate = scheduledServiceDate(now);
    if (serviceDate === null) return;
    const slot = now.toISOString().slice(0, 16);
    if (dispatchedSlots.has(slot)) return;
    dispatchedSlots.add(slot);

    const trigger = 'SCHEDULED' as const;
    const task = dependencies.service
      .recalculate({ serviceDate, trigger })
      .then((result) => {
        dependencies.logger.info('statistics.completed', {
          dataQuality: result.dataQuality,
          serviceDate,
          settlementStatus: result.settlementStatus,
          trigger,
        });
      })
      .catch((error: unknown) => {
        dependencies.logger.error('statistics.failed', {
          error: error instanceof Error ? error.message : String(error),
          serviceDate,
          trigger,
        });
      })
      .finally(() => activeRuns.delete(task));
    activeRuns.add(task);
  }

  tick();
  const interval = setInterval(tick, TICK_MS);
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

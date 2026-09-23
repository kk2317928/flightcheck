import { getMacauDateKey } from '@flightcheck/shared';

import type { FlightSyncService } from './flight-sync.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type SettlementStatus = 'PRELIMINARY' | 'FINAL' | 'FINAL_WITH_WARNINGS';

interface RecoveryStatisticsService {
  recalculate(input: {
    serviceDate: string;
    trigger: 'RECOVERY';
  }): Promise<{ settlementStatus: SettlementStatus }>;
}

export interface StartupRecoveryStore {
  clearExpiredLocks(now: Date): Promise<number>;
  getDailyStatisticStatus(
    serviceDate: string,
  ): Promise<SettlementStatus | null>;
}

export interface StartupRecoveryResult {
  clearedLocks: number;
  syncStatus: string | null;
  statisticsRecovered: boolean;
}

export async function runStartupRecovery(dependencies: {
  store: StartupRecoveryStore;
  flightSync: FlightSyncService;
  statistics: RecoveryStatisticsService;
  now: () => Date;
  logger: {
    info(event: string, context?: Record<string, unknown>): void;
    error(event: string, context?: Record<string, unknown>): void;
  };
}): Promise<StartupRecoveryResult> {
  const instant = dependencies.now();
  const today = getMacauDateKey(instant);
  const yesterday = getMacauDateKey(new Date(instant.getTime() - DAY_MS));
  let clearedLocks = 0;
  let syncStatus: string | null = null;
  let statisticsRecovered = false;

  try {
    clearedLocks = await dependencies.store.clearExpiredLocks(instant);
    dependencies.logger.info('recovery.locks-cleared', { clearedLocks });
  } catch (error) {
    dependencies.logger.error('recovery.lock-cleanup-failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const result = await dependencies.flightSync.run({
      serviceDate: today,
      trigger: 'STARTUP',
    });
    syncStatus = result.status;
    dependencies.logger.info('recovery.flight-sync-completed', {
      status: result.status,
    });
  } catch (error) {
    dependencies.logger.error('recovery.flight-sync-failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const status = await dependencies.store.getDailyStatisticStatus(yesterday);
    if (status !== 'FINAL') {
      const recovered = await dependencies.statistics.recalculate({
        serviceDate: yesterday,
        trigger: 'RECOVERY',
      });
      statisticsRecovered = true;
      dependencies.logger.info('recovery.statistics-completed', {
        serviceDate: yesterday,
        settlementStatus: recovered.settlementStatus,
      });
    }
  } catch (error) {
    dependencies.logger.error('recovery.statistics-failed', {
      error: error instanceof Error ? error.message : String(error),
      serviceDate: yesterday,
    });
  }

  return { clearedLocks, syncStatus, statisticsRecovered };
}

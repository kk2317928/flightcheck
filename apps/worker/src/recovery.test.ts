import { describe, expect, it, vi } from 'vitest';

import { runStartupRecovery } from './recovery.js';

const now = new Date('2026-09-23T00:15:00.000Z');

function harness(
  settlementStatus:
    'PRELIMINARY' | 'FINAL' | 'FINAL_WITH_WARNINGS' | null = 'PRELIMINARY',
) {
  const events: string[] = [];
  const store = {
    clearExpiredLocks: vi.fn(() => {
      events.push('cleanup');
      return Promise.resolve(2);
    }),
    getDailyStatisticStatus: vi.fn(() => {
      events.push('inspect-statistics');
      return Promise.resolve(settlementStatus);
    }),
  };
  const flightSync = vi.fn(() => {
    events.push('sync');
    return Promise.resolve({
      status: 'SUCCESS' as const,
      correlationId: 'sync-1',
      directions: [],
    });
  });
  const recalculate = vi.fn(() => {
    events.push('recalculate');
    return Promise.resolve({ settlementStatus: 'FINAL' as const });
  });
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { events, store, flightSync, recalculate, logger };
}

describe('runStartupRecovery', () => {
  it('clears expired locks, syncs, then recovers yesterday before schedulers start', async () => {
    const h = harness();
    const result = await runStartupRecovery({
      store: h.store,
      flightSync: { run: h.flightSync },
      statistics: { recalculate: h.recalculate },
      logger: h.logger,
      now: () => now,
    });

    expect(h.events).toEqual([
      'cleanup',
      'sync',
      'inspect-statistics',
      'recalculate',
    ]);
    expect(h.flightSync).toHaveBeenCalledWith({
      serviceDate: '2026-09-23',
      trigger: 'STARTUP',
    });
    expect(h.recalculate).toHaveBeenCalledWith({
      serviceDate: '2026-09-22',
      trigger: 'RECOVERY',
    });
    expect(result).toEqual({
      clearedLocks: 2,
      syncStatus: 'SUCCESS',
      statisticsRecovered: true,
    });
  });

  it('does not rewrite a FINAL statistic on repeated startup', async () => {
    const h = harness('FINAL');
    await runStartupRecovery({
      store: h.store,
      flightSync: { run: h.flightSync },
      statistics: { recalculate: h.recalculate },
      logger: h.logger,
      now: () => now,
    });
    expect(h.recalculate).not.toHaveBeenCalled();
  });

  it('isolates failures so later safe recovery actions still run', async () => {
    const h = harness();
    h.store.clearExpiredLocks.mockRejectedValueOnce(new Error('database busy'));
    h.flightSync.mockRejectedValueOnce(new Error('source timeout'));

    const result = await runStartupRecovery({
      store: h.store,
      flightSync: { run: h.flightSync },
      statistics: { recalculate: h.recalculate },
      logger: h.logger,
      now: () => now,
    });

    expect(h.recalculate).toHaveBeenCalledOnce();
    expect(h.logger.error).toHaveBeenCalledTimes(2);
    expect(result.statisticsRecovered).toBe(true);
  });
});

/* eslint-disable @typescript-eslint/require-await */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatisticsService } from './statistics-service.js';
import { startStatisticsScheduler } from './statistics-scheduler.js';

describe('startStatisticsScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness(instant: string) {
    vi.setSystemTime(new Date(instant));
    const recalculate = vi.fn<StatisticsService['recalculate']>(
      async (input) =>
        ({
          serviceDate: input.serviceDate,
        }) as never,
    );
    const logger = { error: vi.fn(), info: vi.fn() };
    const scheduler = startStatisticsScheduler({
      service: { recalculate },
      now: () => new Date(),
      logger,
    });
    return { logger, recalculate, scheduler };
  }

  it.each([
    ['2026-09-22T15:30:00.000Z', '2026-09-22'],
    ['2026-09-22T16:05:00.000Z', '2026-09-22'],
    ['2026-09-22T17:05:00.000Z', '2026-09-22'],
    ['2026-09-22T21:05:00.000Z', '2026-09-22'],
    ['2026-09-22T22:00:00.000Z', '2026-09-22'],
  ])('dispatches the settlement slot at %s', async (instant, serviceDate) => {
    const { recalculate, scheduler } = harness(instant);
    await scheduler.waitForIdle();
    expect(recalculate).toHaveBeenCalledWith({
      serviceDate,
      trigger: 'SCHEDULED',
    });
    scheduler.stop();
  });

  it('does not dispatch outside a settlement slot', async () => {
    const { recalculate, scheduler } = harness('2026-09-22T16:04:00.000Z');
    await scheduler.waitForIdle();
    expect(recalculate).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('reruns the same service date after a process restart', async () => {
    const first = harness('2026-09-22T16:05:00.000Z');
    await first.scheduler.waitForIdle();
    first.scheduler.stop();

    const second = harness('2026-09-22T16:05:00.000Z');
    await second.scheduler.waitForIdle();
    expect(first.recalculate).toHaveBeenCalledTimes(1);
    expect(second.recalculate).toHaveBeenCalledWith({
      serviceDate: '2026-09-22',
      trigger: 'SCHEDULED',
    });
    second.scheduler.stop();
  });

  it('logs a rejected recalculation and continues to a later slot', async () => {
    vi.setSystemTime(new Date('2026-09-22T16:05:00.000Z'));
    const recalculate = vi
      .fn<StatisticsService['recalculate']>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue({
        dataQuality: 'COMPLETE',
        settlementStatus: 'FINAL',
      } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const scheduler = startStatisticsScheduler({
      service: { recalculate },
      now: () => new Date(),
      logger,
    });
    await scheduler.waitForIdle();
    expect(logger.error).toHaveBeenCalledWith('statistics.failed', {
      error: 'database unavailable',
      serviceDate: '2026-09-22',
      trigger: 'SCHEDULED',
    });
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await scheduler.waitForIdle();
    expect(recalculate).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});

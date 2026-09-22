/* eslint-disable @typescript-eslint/require-await */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlightSyncService } from './flight-sync.js';
import { startFlightSyncScheduler } from './scheduler.js';

describe('startFlightSyncScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs immediately and every five minutes until stopped', async () => {
    const run = vi.fn(async () => ({
      status: 'SUCCESS' as const,
      correlationId: 'owner',
      directions: [],
    }));
    const scheduler = startFlightSyncScheduler({
      service: { run } satisfies FlightSyncService,
      now: () => new Date('2026-09-21T16:30:00.000Z'),
      logger: { error: vi.fn() },
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenLastCalledWith({
      serviceDate: '2026-09-22',
      trigger: 'STARTUP',
    });

    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith({
      serviceDate: '2026-09-22',
      trigger: 'SCHEDULED',
    });
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('logs a rejected run and continues future ticks', async () => {
    const error = vi.fn();
    const run = vi
      .fn<FlightSyncService['run']>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({
        status: 'SUCCESS',
        correlationId: 'owner',
        directions: [],
      });
    const scheduler = startFlightSyncScheduler({
      service: { run },
      now: () => new Date('2026-09-22T00:00:00.000Z'),
      logger: { error },
    });
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith('flight-sync.failed', {
      error: 'network down',
      trigger: 'STARTUP',
    });

    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});

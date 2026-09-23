import { afterEach, describe, expect, it, vi } from 'vitest';

import { startWorkerHeartbeat } from './heartbeat.js';

describe('startWorkerHeartbeat', () => {
  afterEach(() => vi.useRealTimers());

  it('persists and logs startup and one-minute heartbeats without sensitive data', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-09-23T00:00:00.000Z');
    vi.setSystemTime(start);
    const record = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
    const heartbeat = startWorkerHeartbeat({
      store: { record },
      ownerId: 'worker-1',
      logger,
      now: () => new Date(),
    });

    await heartbeat.waitForIdle();
    expect(record).toHaveBeenNthCalledWith(1, {
      ownerId: 'worker-1',
      observedAt: start,
      expiresAt: new Date('2026-09-23T00:02:00.000Z'),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await heartbeat.waitForIdle();
    expect(record).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenLastCalledWith('worker.heartbeat', {
      health: { service: 'worker', status: 'ok' },
      observedAt: '2026-09-23T00:01:00.000Z',
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(
      /password|token|rawSource/i,
    );
    heartbeat.stop();
  });

  it('logs persistence failure and continues later heartbeats', async () => {
    vi.useFakeTimers();
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error('database busy'))
      .mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
    const heartbeat = startWorkerHeartbeat({
      store: { record },
      ownerId: 'worker-1',
      logger,
      now: () => new Date(),
    });

    await heartbeat.waitForIdle();
    await vi.advanceTimersByTimeAsync(60_000);
    await heartbeat.waitForIdle();
    expect(record).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledOnce();
    heartbeat.stop();
  });
});

/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';
import { installWorkerSignalHandlers, runWorkerStartup } from './runtime.js';

const environment = {
  TZ: 'Asia/Macau',
  DATABASE_URL:
    'postgresql://flightcheck:flightcheck@localhost:5432/flightcheck',
};

describe('runWorkerStartup', () => {
  it('recovers before heartbeat and scheduling start', async () => {
    const lines: string[] = [];
    const events: string[] = [];
    const stop = vi.fn();
    const disconnect = vi.fn(async () => undefined);
    const flightSyncService = { run: vi.fn() };
    const statisticsService = { recalculate: vi.fn() };
    const createServices = vi.fn(() => ({
      flightSyncService,
      statisticsService,
      recoveryStore: {
        clearExpiredLocks: vi.fn(async () => 0),
        getDailyStatisticStatus: vi.fn(async () => 'FINAL' as const),
      },
      heartbeatStore: { record: vi.fn(async () => undefined) },
      heartbeatOwnerId: 'worker-1',
      prisma: { $disconnect: disconnect },
      logger: {},
    }));
    const startScheduler = vi.fn(() => ({
      stop,
      waitForIdle: vi.fn(async () => undefined),
    }));
    const runRecovery = vi.fn(async () => {
      events.push('recovery');
      return {
        clearedLocks: 0,
        syncStatus: 'SUCCESS',
        statisticsRecovered: false,
      };
    });
    const startHeartbeat = vi.fn(() => {
      events.push('heartbeat');
      return {
        stop: vi.fn(),
        waitForIdle: vi.fn(async () => undefined),
      };
    });
    startScheduler.mockImplementation(() => {
      events.push('scheduler');
      return { stop, waitForIdle: vi.fn(async () => undefined) };
    });
    const runtime = await runWorkerStartup(
      (line) => lines.push(line),
      environment,
      {
        createServices,
        startScheduler,
        startStatisticsScheduler: startScheduler,
        runRecovery,
        startHeartbeat,
      },
    );
    expect(createServices).toHaveBeenCalledTimes(1);
    expect(startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        service: flightSyncService,
        runOnStart: false,
      }),
    );
    expect(startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ service: statisticsService }),
    );
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'info',
      service: 'worker',
      event: 'worker.ready',
      health: { service: 'worker', status: 'ok' },
    });
    expect(events).toEqual(['recovery', 'heartbeat', 'scheduler', 'scheduler']);
    runtime.stop();
    runtime.stop();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('fails environment validation before composition', async () => {
    const createServices = vi.fn();
    await expect(
      runWorkerStartup(() => undefined, {}, { createServices }),
    ).rejects.toThrow(/TZ/);
    expect(createServices).not.toHaveBeenCalled();
  });

  it('stops scheduling and disconnects on termination signal', async () => {
    const stop = vi.fn();
    const disconnect = vi.fn(async () => undefined);
    let finish!: () => void;
    const waitForIdle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const handlers = new Map<string, () => void>();
    const processPort = {
      once: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
        return processPort;
      }),
    };
    installWorkerSignalHandlers(
      {
        stop,
        disconnect,
        shutdown: async () => {
          stop();
          await waitForIdle();
          await disconnect();
        },
      },
      processPort as unknown as Pick<NodeJS.Process, 'once'>,
    );
    handlers.get('SIGTERM')?.();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });
});

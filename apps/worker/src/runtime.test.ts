/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';
import { installWorkerSignalHandlers, runWorkerStartup } from './runtime.js';

const environment = {
  TZ: 'Asia/Macau',
  DATABASE_URL:
    'postgresql://flightcheck:flightcheck@localhost:5432/flightcheck',
};

describe('runWorkerStartup', () => {
  it('validates, composes, logs readiness, and starts scheduling', () => {
    const lines: string[] = [];
    const stop = vi.fn();
    const disconnect = vi.fn(async () => undefined);
    const flightSyncService = { run: vi.fn() };
    const statisticsService = { recalculate: vi.fn() };
    const createServices = vi.fn(() => ({
      flightSyncService,
      statisticsService,
      prisma: { $disconnect: disconnect },
      logger: {},
    }));
    const startScheduler = vi.fn(() => ({
      stop,
      waitForIdle: vi.fn(async () => undefined),
    }));
    const runtime = runWorkerStartup((line) => lines.push(line), environment, {
      createServices,
      startScheduler,
      startStatisticsScheduler: startScheduler,
    });
    expect(createServices).toHaveBeenCalledTimes(1);
    expect(startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ service: flightSyncService }),
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
    runtime.stop();
    runtime.stop();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('fails environment validation before composition', () => {
    const createServices = vi.fn();
    expect(() =>
      runWorkerStartup(() => undefined, {}, { createServices }),
    ).toThrow(/TZ/);
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

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
    const createServices = vi.fn(() => ({
      flightSyncService,
      prisma: { $disconnect: disconnect },
      logger: {},
    }));
    const startScheduler = vi.fn(() => ({ stop }));
    const runtime = runWorkerStartup((line) => lines.push(line), environment, {
      createServices,
      startScheduler,
    });
    expect(createServices).toHaveBeenCalledTimes(1);
    expect(startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ service: flightSyncService }),
    );
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'info',
      service: 'worker',
      event: 'worker.ready',
      health: { service: 'worker', status: 'ok' },
    });
    runtime.stop();
    runtime.stop();
    expect(stop).toHaveBeenCalledTimes(1);
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
    const handlers = new Map<string, () => void>();
    const processPort = {
      once: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
        return processPort;
      }),
    };
    installWorkerSignalHandlers(
      { stop, disconnect },
      processPort as unknown as Pick<NodeJS.Process, 'once'>,
    );
    handlers.get('SIGTERM')?.();
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

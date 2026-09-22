/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';

import type { FlightSyncService } from './flight-sync.js';
import { runFlightSyncCli } from './cli.js';

function harness(status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED_LOCKED') {
  const run = vi.fn(async () => ({
    status,
    correlationId: 'manual-owner',
    directions: [],
  }));
  const disconnect = vi.fn(async () => undefined);
  const lines: string[] = [];
  return {
    dependencies: {
      service: { run } satisfies FlightSyncService,
      now: () => new Date('2026-09-21T16:30:00.000Z'),
      disconnect,
      write: (line: string) => lines.push(line),
    },
    run,
    disconnect,
    lines,
  };
}

describe('runFlightSyncCli', () => {
  it('uses an explicit valid date and MANUAL trigger', async () => {
    const test = harness('SUCCESS');
    await expect(
      runFlightSyncCli(['--date', '2026-09-22'], test.dependencies),
    ).resolves.toBe(0);
    expect(test.run).toHaveBeenCalledWith({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });
    expect(JSON.parse(test.lines[0]!)).toMatchObject({ status: 'SUCCESS' });
    expect(test.disconnect).toHaveBeenCalledTimes(1);
  });

  it('defaults to the Macau-local current date', async () => {
    const test = harness('PARTIAL');
    await runFlightSyncCli([], test.dependencies);
    expect(test.run).toHaveBeenCalledWith({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });
  });

  it.each([
    ['missing date', ['--date']],
    ['invalid calendar date', ['--date', '2026-02-30']],
    ['unknown argument', ['--force']],
    ['extra argument', ['--date', '2026-09-22', 'extra']],
  ])('rejects %s before acquiring services', async (_label, args) => {
    const test = harness('SUCCESS');
    await expect(runFlightSyncCli(args, test.dependencies)).rejects.toThrow();
    expect(test.run).not.toHaveBeenCalled();
    expect(test.disconnect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['FAILED', 1],
    ['SKIPPED_LOCKED', 0],
  ] as const)('returns %s as exit code %i', async (status, exitCode) => {
    const test = harness(status);
    await expect(runFlightSyncCli([], test.dependencies)).resolves.toBe(
      exitCode,
    );
    expect(test.disconnect).toHaveBeenCalledTimes(1);
  });
});

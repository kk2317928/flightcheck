import { describe, expect, it } from 'vitest';

import { runWorkerStartup } from './runtime.js';

describe('runWorkerStartup', () => {
  it('writes a structured ready log with a job correlation ID', () => {
    const lines: string[] = [];

    runWorkerStartup((line) => lines.push(line), { TZ: 'Asia/Macau' });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'info',
      service: 'worker',
      event: 'worker.ready',
      health: { service: 'worker', status: 'ok' },
    });
    expect(record.correlationId).toMatch(/^job:worker-start:[0-9a-f-]{36}$/);
  });

  it('fails before startup when required environment is missing', () => {
    expect(() => runWorkerStartup(() => undefined, {})).toThrow(/TZ/);
  });
});

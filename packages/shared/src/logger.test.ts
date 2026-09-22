import { describe, expect, it } from 'vitest';

import { createLogger, redactSensitiveFields } from './logger.js';

describe('createLogger', () => {
  it('writes structured records with correlation context', () => {
    const records: string[] = [];
    const logger = createLogger({
      service: 'worker',
      sink: (line) => records.push(line),
    });

    logger.info('worker.ready', {
      correlationId: 'job:ready:123',
      flightCount: 4,
    });

    expect(JSON.parse(records[0] ?? '{}')).toMatchObject({
      correlationId: 'job:ready:123',
      event: 'worker.ready',
      flightCount: 4,
      level: 'info',
      service: 'worker',
    });
  });

  it('redacts sensitive fields recursively and case-insensitively', () => {
    const records: string[] = [];
    const logger = createLogger({
      service: 'web',
      sink: (line) => records.push(line),
    });

    logger.warn('request.rejected', {
      authorization: 'Bearer raw-token',
      nested: {
        Password: 'plain-password',
        socialAccessToken: 'social-token',
        safe: 'visible',
      },
    });

    const record = JSON.parse(records[0] ?? '{}') as Record<string, unknown>;
    expect(JSON.stringify(record)).not.toContain('raw-token');
    expect(JSON.stringify(record)).not.toContain('plain-password');
    expect(JSON.stringify(record)).not.toContain('social-token');
    expect(record).toMatchObject({
      authorization: '[REDACTED]',
      nested: {
        Password: '[REDACTED]',
        safe: 'visible',
        socialAccessToken: '[REDACTED]',
      },
    });
  });

  it('does not invoke custom serialization that can reveal secrets', () => {
    const records: string[] = [];
    const logger = createLogger({
      service: 'web',
      sink: (line) => records.push(line),
    });

    logger.info('unsafe.payload', {
      payload: {
        toJSON: () => ({
          password: 'plain-password',
          accessToken: 'raw-token',
        }),
      },
    });

    expect(records[0]).not.toContain('plain-password');
    expect(records[0]).not.toContain('raw-token');
  });

  it('keeps canonical metadata when context uses reserved names', () => {
    const records: string[] = [];
    const logger = createLogger({
      service: 'worker',
      sink: (line) => records.push(line),
    });

    logger.info('worker.ready', { level: 'error', service: 'spoofed' });

    expect(JSON.parse(records[0] ?? '{}')).toMatchObject({
      event: 'worker.ready',
      level: 'info',
      service: 'worker',
    });
  });

  it('handles self-referential arrays', () => {
    const circular: unknown[] = [];
    circular.push(circular);

    expect(() =>
      JSON.stringify(redactSensitiveFields({ circular })),
    ).not.toThrow();
  });
});

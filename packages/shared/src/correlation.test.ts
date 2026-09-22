import { describe, expect, it } from 'vitest';

import {
  CORRELATION_ID_HEADER,
  createJobCorrelationId,
  getOrCreateRequestCorrelationId,
} from './correlation.js';

describe('correlation IDs', () => {
  it('preserves a valid incoming request ID', () => {
    const headers = new Headers({ [CORRELATION_ID_HEADER]: 'request-123' });
    expect(getOrCreateRequestCorrelationId(headers)).toBe('request-123');
  });

  it('replaces an unsafe incoming request ID', () => {
    const headers = new Headers({ [CORRELATION_ID_HEADER]: 'contains spaces' });
    expect(getOrCreateRequestCorrelationId(headers)).toMatch(
      /^request:[0-9a-f-]{36}$/,
    );
  });

  it('prefixes job IDs with a safe job name', () => {
    expect(createJobCorrelationId('worker-heartbeat')).toMatch(
      /^job:worker-heartbeat:[0-9a-f-]{36}$/,
    );
  });
});

import { describe, expect, it } from 'vitest';

import { getWorkerHealth } from './health.js';

describe('getWorkerHealth', () => {
  it('returns a stable healthy service contract', () => {
    expect(getWorkerHealth()).toEqual({ service: 'worker', status: 'ok' });
  });
});

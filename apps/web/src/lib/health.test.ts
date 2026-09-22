import { describe, expect, it } from 'vitest';

import { getWebHealth } from './health';

describe('getWebHealth', () => {
  it('returns a stable healthy service contract', () => {
    expect(getWebHealth()).toEqual({ service: 'web', status: 'ok' });
  });
});

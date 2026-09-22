import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './env.js';

describe('parseEnvironment', () => {
  it('coerces validated runtime values', () => {
    expect(
      parseEnvironment({
        NODE_ENV: 'production',
        TZ: 'Asia/Macau',
        WEB_PORT: '3100',
        WORKER_HEARTBEAT_INTERVAL_MS: '45000',
      }),
    ).toEqual({
      NODE_ENV: 'production',
      TZ: 'Asia/Macau',
      WEB_PORT: 3100,
      WORKER_HEARTBEAT_INTERVAL_MS: 45000,
    });
  });

  it('fails fast when the required timezone is missing', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'development' })).toThrow(/TZ/);
  });

  it('rejects a timezone other than Asia/Macau', () => {
    expect(() => parseEnvironment({ TZ: 'UTC' })).toThrow(/Asia\/Macau/);
  });
});

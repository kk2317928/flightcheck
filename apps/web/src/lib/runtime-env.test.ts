import { describe, expect, it } from 'vitest';

import {
  normalizeWebRuntimeEnvironment,
  validateWebEnvironment,
} from './runtime-env';

describe('validateWebEnvironment', () => {
  it('uses the application Macau time zone when the platform reserves TZ', () => {
    expect(
      validateWebEnvironment({
        DATABASE_URL: 'postgresql://user:password@example.com:5432/flightcheck',
        TZ: 'UTC',
      }).TZ,
    ).toBe('Asia/Macau');
  });
  it('passes a Macau time zone to Worker services on Vercel', () => {
    expect(
      normalizeWebRuntimeEnvironment({
        TZ: 'UTC',
        DATABASE_URL: 'postgresql://db',
      }),
    ).toEqual({
      TZ: 'Asia/Macau',
      DATABASE_URL: 'postgresql://db',
    });
  });
});

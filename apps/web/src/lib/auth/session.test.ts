import { describe, expect, it } from 'vitest';

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_OPTIONS,
  createSessionToken,
  hashSessionToken,
} from './session';

describe('admin session tokens', () => {
  it('stores only a one-way hash of a high-entropy raw token', () => {
    const rawToken = createSessionToken();
    const tokenHash = hashSessionToken(rawToken);

    expect(rawToken.length).toBeGreaterThanOrEqual(43);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(rawToken);
  });

  it('uses a host-bound secure cookie policy', () => {
    expect(ADMIN_SESSION_COOKIE).toBe('__Host-flightcheck_admin_session');
    expect(ADMIN_SESSION_COOKIE_OPTIONS).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
  });
});

import { describe, expect, it, vi } from 'vitest';

import { authorizeAdminRequest } from './guard';

describe('Admin request guard', () => {
  it('redirects unauthenticated Admin pages to login', async () => {
    await expect(
      authorizeAdminRequest({
        pathname: '/admin/flights',
        rawToken: undefined,
        authenticate: vi.fn(),
      }),
    ).resolves.toEqual({
      type: 'redirect',
      location: '/admin/login?next=%2Fadmin%2Fflights',
    });
  });

  it('returns unauthorized for unauthenticated Admin APIs', async () => {
    await expect(
      authorizeAdminRequest({
        pathname: '/api/admin/flights/sync',
        rawToken: undefined,
        authenticate: vi.fn(),
      }),
    ).resolves.toEqual({ type: 'unauthorized' });
  });

  it('allows only an active database session', async () => {
    const authenticate = vi
      .fn()
      .mockResolvedValue({ admin: { id: 'admin-1' } });

    await expect(
      authorizeAdminRequest({
        pathname: '/admin',
        rawToken: 'raw-token',
        authenticate,
      }),
    ).resolves.toEqual({ type: 'allow' });
    expect(authenticate).toHaveBeenCalledWith('raw-token');
  });

  it('leaves the login endpoints public', async () => {
    await expect(
      authorizeAdminRequest({
        pathname: '/api/admin/auth/login',
        rawToken: undefined,
        authenticate: vi.fn(),
      }),
    ).resolves.toEqual({ type: 'allow' });
  });
});

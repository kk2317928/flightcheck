import { describe, expect, it, vi } from 'vitest';

const logout = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../../lib/auth/runtime', () => ({
  getAuthService: () => ({ logout }),
}));

import { POST } from './route';

describe('POST /api/admin/auth/logout', () => {
  it('revokes the session and expires its cookie', async () => {
    const response = await POST(
      new Request('https://example.com/api/admin/auth/logout', {
        method: 'POST',
        headers: {
          cookie: '__Host-flightcheck_admin_session=raw-session-token',
          'x-real-ip': '203.0.113.8',
        },
      }),
    );

    expect(logout).toHaveBeenCalledWith('raw-session-token', 'untrusted');
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toMatch(
      /__Host-flightcheck_admin_session=.*Max-Age=0/i,
    );
  });
});

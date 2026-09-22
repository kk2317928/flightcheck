import { beforeEach, describe, expect, it, vi } from 'vitest';

const login = vi.fn();
vi.mock('../../../../../lib/auth/runtime', () => ({
  getAuthService: () => ({ login }),
}));

import { POST } from './route';

describe('POST /api/admin/auth/login', () => {
  beforeEach(() => login.mockReset());

  it('sets the hardened session cookie after valid credentials', async () => {
    login.mockResolvedValue({
      ok: true,
      rawToken: 'raw-session-token',
      tokenHash: 'stored-hash',
      adminId: 'admin-1',
      expiresAt: new Date('2026-09-22T18:00:00.000Z'),
    });

    const response = await POST(
      new Request('https://example.com/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-real-ip': '203.0.113.8',
        },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'secret',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain(
      '__Host-flightcheck_admin_session=raw-session-token',
    );
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=strict/i);
  });

  it('returns 429 without a cookie when rate limited', async () => {
    login.mockResolvedValue({ ok: false, reason: 'RATE_LIMITED' });

    const response = await POST(
      new Request('https://example.com/api/admin/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'secret',
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.has('set-cookie')).toBe(false);
  });
});

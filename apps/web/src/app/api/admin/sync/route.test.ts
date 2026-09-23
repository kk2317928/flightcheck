import { beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ authenticate: vi.fn(), sync: vi.fn() }));
vi.mock('../../../../lib/admin/runtime', () => ({
  getAdminOperationRuntime: () => runtime,
}));
import { POST } from './route';

describe('POST /api/admin/sync', () => {
  beforeEach(() => {
    runtime.authenticate.mockReset();
    runtime.sync.mockReset();
  });
  const request = (origin = 'https://flight.test') =>
    new Request('https://flight.test/api/admin/sync', {
      method: 'POST',
      headers: {
        origin,
        cookie: '__Host-flightcheck_admin=token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ serviceDate: '2026-09-22' }),
    });
  it('rejects unauthenticated calls', async () => {
    runtime.authenticate.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
  });
  it('rejects cross-origin mutations', async () => {
    runtime.authenticate.mockResolvedValue({ admin: { id: 'admin' } });
    expect((await POST(request('https://evil.test'))).status).toBe(403);
  });
  it('returns the shared lease overlap result', async () => {
    runtime.authenticate.mockResolvedValue({ admin: { id: 'admin' } });
    runtime.sync.mockResolvedValue({ status: 'SKIPPED_LOCKED' });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'SKIPPED_LOCKED',
    });
  });
});

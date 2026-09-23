import { describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  authenticate: vi.fn().mockResolvedValue({ admin: { id: 'admin' } }),
  recalculate: vi.fn(),
}));
vi.mock('../../../../../lib/admin/runtime', () => ({
  getAdminOperationRuntime: () => runtime,
}));
import { POST } from './route';
describe('POST /api/admin/statistics/recalculate', () => {
  it('requires explicit confirmation', async () => {
    const request = new Request(
      'https://flight.test/api/admin/statistics/recalculate',
      {
        method: 'POST',
        headers: {
          origin: 'https://flight.test',
          cookie: '__Host-flightcheck_admin=token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ serviceDate: '2026-09-22', confirmed: false }),
      },
    );
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(runtime.recalculate).not.toHaveBeenCalled();
  });
});

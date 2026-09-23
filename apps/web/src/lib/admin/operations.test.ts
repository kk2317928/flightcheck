/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';
import { createAdminOperations } from './operations';

describe('AdminOperations', () => {
  it('returns the shared sync lease result and audits it', async () => {
    const audit = vi.fn(async () => undefined);
    const operations = createAdminOperations({
      flightSync: {
        run: vi.fn(async () => ({
          status: 'SKIPPED_LOCKED',
          correlationId: 'owner',
          directions: [],
        })),
      },
      statistics: { recalculate: vi.fn() },
      audit,
    });
    await expect(
      operations.sync({ adminId: 'admin', serviceDate: '2026-09-22' }),
    ).resolves.toMatchObject({ status: 'SKIPPED_LOCKED' });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_FLIGHT_SYNC',
        adminId: 'admin',
        resultCode: 'SKIPPED_LOCKED',
      }),
    );
  });

  it('audits a confirmed manual recalculation without raw source data', async () => {
    const audit = vi.fn(async () => undefined);
    const operations = createAdminOperations({
      flightSync: { run: vi.fn() },
      statistics: {
        recalculate: vi.fn(async () => ({
          serviceDate: '2026-09-22',
          settlementStatus: 'FINAL',
        })),
      },
      audit,
    });
    await operations.recalculate({
      adminId: 'admin',
      serviceDate: '2026-09-22',
    });
    expect(audit).toHaveBeenCalledWith({
      action: 'ADMIN_STATISTICS_RECALCULATE',
      adminId: 'admin',
      serviceDate: '2026-09-22',
      resultCode: 'FINAL',
    });
  });
});

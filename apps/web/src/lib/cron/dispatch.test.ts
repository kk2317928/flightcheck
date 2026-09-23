/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';

import { createCronDispatch } from './dispatch';

const at = new Date('2026-09-23T16:05:00.000Z'); // 00:05 in Macau

describe('cron dispatch', () => {
  it('rejects missing or wrong secrets before opening the database', async () => {
    const buildServices = vi.fn();
    const dispatch = createCronDispatch({
      secret: 'private-key',
      now: () => at,
      buildServices,
    });
    for (const header of [null, 'Bearer wrong', 'private-key']) {
      const response = await dispatch(
        new Request('https://example.com/api/cron/tick', {
          headers: header ? { authorization: header } : {},
        }),
      );
      expect(response.status).toBe(401);
    }
    expect(buildServices).not.toHaveBeenCalled();
  });

  it('rejects all calls when the Cron secret is not configured', async () => {
    const dispatch = createCronDispatch({
      secret: undefined,
      now: () => at,
      buildServices: () => {
        throw new Error('must not connect');
      },
    });
    const response = await dispatch(
      new Request('https://example.com/api/cron/tick', {
        headers: { authorization: 'Bearer undefined' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('syncs the Macau service day and settles yesterday after midnight', async () => {
    const recalculate = vi.fn(
      async ({ serviceDate }: { serviceDate: string }) => ({
        serviceDate,
        settlementStatus: 'FINAL',
      }),
    );
    const disconnect = vi.fn(async () => undefined);
    const dispatch = createCronDispatch({
      secret: 'private-key',
      now: () => at,
      buildServices: () => ({
        flightSyncService: {
          run: vi.fn(async () => ({ status: 'SUCCESS' })),
        },
        statisticsService: { recalculate },
        prisma: { $disconnect: disconnect },
      }),
    });
    const response = await dispatch(
      new Request('https://example.com/api/cron/tick', {
        headers: { authorization: 'Bearer private-key' },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      serviceDate: '2026-09-24',
      syncStatus: 'SUCCESS',
      statistics: ['2026-09-24', '2026-09-23'],
    });
    expect(recalculate.mock.calls.map(([input]) => input.serviceDate)).toEqual([
      '2026-09-24',
      '2026-09-23',
    ]);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('reports a failed source and closes connections without masking degraded data', async () => {
    const disconnect = vi.fn(async () => undefined);
    const dispatch = createCronDispatch({
      secret: 'private-key',
      now: () => new Date('2026-09-23T12:00:00.000Z'),
      buildServices: () => ({
        flightSyncService: { run: vi.fn(async () => ({ status: 'FAILED' })) },
        statisticsService: {
          recalculate: vi.fn(async () => ({ settlementStatus: 'PRELIMINARY' })),
        },
        prisma: { $disconnect: disconnect },
      }),
    });
    const response = await dispatch(
      new Request('https://example.com/api/cron/tick', {
        headers: { authorization: 'Bearer private-key' },
      }),
    );
    expect(response.status).toBe(503);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('still settles yesterday when the 06:00 deadline invocation arrives late', async () => {
    const dates: string[] = [];
    const dispatch = createCronDispatch({
      secret: 'private-key',
      now: () => new Date('2026-09-23T22:03:00.000Z'), // 06:03 in Macau
      buildServices: () => ({
        flightSyncService: { run: async () => ({ status: 'SUCCESS' }) },
        statisticsService: {
          recalculate: async ({ serviceDate }) => {
            dates.push(serviceDate);
          },
        },
        prisma: { $disconnect: async () => undefined },
      }),
    });
    await dispatch(
      new Request('https://example.com/api/cron/tick', {
        headers: { authorization: 'Bearer private-key' },
      }),
    );
    expect(dates).toEqual(['2026-09-24', '2026-09-23']);
  });

  it('closes the database when syncing throws so the next Cron run can recover', async () => {
    const disconnect = vi.fn(async () => undefined);
    const dispatch = createCronDispatch({
      secret: 'private-key',
      now: () => at,
      buildServices: () => ({
        flightSyncService: {
          run: async () => {
            throw new Error('source unavailable');
          },
        },
        statisticsService: { recalculate: async () => undefined },
        prisma: { $disconnect: disconnect },
      }),
    });
    await expect(
      dispatch(
        new Request('https://example.com/api/cron/tick', {
          headers: { authorization: 'Bearer private-key' },
        }),
      ),
    ).rejects.toThrow('source unavailable');
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

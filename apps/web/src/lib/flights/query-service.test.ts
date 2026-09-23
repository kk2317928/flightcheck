/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';

import { FlightListQuerySchema } from './query-schema.js';
import { createFlightQueryService } from './query-service.js';

describe('public flight query boundary', () => {
  it('validates dates, flight numbers, directions and pagination', () => {
    expect(() => FlightListQuerySchema.parse({ date: '2026-02-30' })).toThrow();
    expect(FlightListQuerySchema.parse({ flight: 'nx862d' })).toMatchObject({
      flight: 'NX862D',
      page: 1,
      pageSize: 20,
    });
    expect(
      FlightListQuerySchema.parse({ page: 999999, pageSize: 500 }),
    ).toMatchObject({
      page: 999999,
      pageSize: 100,
    });
    expect(() => FlightListQuerySchema.parse({ direction: 'BOTH' })).toThrow();
  });

  it('maps repository records to public-safe DTOs', async () => {
    const repository = {
      getDailySummary: vi.fn(async () => null),
      listFlights: vi.fn(async () => ({
        items: [
          {
            id: 'instance-1',
            flightNumber: 'NX862D',
            serviceDate: new Date('2026-09-22'),
            direction: 'DEPARTURE',
            scheduledAt: new Date('2026-09-22T08:00:00Z'),
            estimatedAt: null,
            actualAt: null,
            originCode: 'MFM',
            destinationCode: 'TPE',
            gate: null,
            operationalStatus: 'SCHEDULED',
            performanceStatus: 'PENDING',
            delayMinutes: null,
            updatedAt: new Date('2026-09-22T07:55:00Z'),
            warnings: ['private'],
            correlationId: 'private',
          },
        ],
        total: 1,
      })),
      getFlightDetails: vi.fn(),
      listHistory: vi.fn(),
      listCancellations: vi.fn(),
    };
    const result = await createFlightQueryService(
      repository as never,
    ).listFlights({
      flight: 'NX862D',
      page: 1,
      pageSize: 20,
    });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(result.items[0]?.flightNumber).toBe('NX862D');
    expect(Object.keys(result.items[0] ?? {})).not.toContain('warnings');
    expect(Object.keys(result.items[0] ?? {})).not.toContain('correlationId');
  });
});

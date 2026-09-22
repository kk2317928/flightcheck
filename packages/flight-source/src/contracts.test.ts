import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  FlightSourceFetchResultSchema,
  type FlightSourceAdapter,
  type FlightSourceFetchResult,
  type NormalizedFlight,
  type RawAirportFlight,
} from './index';

const fetchedAt = new Date('2026-09-22T02:05:00.000Z');
const normalizedFlight: NormalizedFlight = {
  flightNumber: 'NX862D',
  serviceDate: '2026-09-22',
  direction: 'DEPARTURE',
  scheduledAt: new Date('2026-09-22T02:30:00.000Z'),
  estimatedAt: null,
  actualAt: null,
  origin: { code: 'MFM', name: 'Macau' },
  destination: { code: 'NRT', name: 'Tokyo Narita' },
  sourceStatus: 'SCHEDULED',
  rawStatus: 'Scheduled',
};

describe('flight source contracts', () => {
  it('accepts a complete normalized result and preserves suffixed flight numbers', () => {
    const result = FlightSourceFetchResultSchema.parse({
      status: 'COMPLETE',
      flights: [normalizedFlight],
      warnings: [],
      fetchedAt,
      sourceUpdatedAt: new Date('2026-09-22T02:04:00.000Z'),
    });

    expect(result.flights[0]?.flightNumber).toBe('NX862D');
    expect(typeof result.flights[0]?.flightNumber).toBe('string');
  });

  it('accepts partial results with usable flights and structured warnings', () => {
    const result = FlightSourceFetchResultSchema.parse({
      status: 'PARTIAL',
      flights: [normalizedFlight],
      warnings: [
        {
          code: 'MALFORMED_ROW',
          message: 'Skipped row without a scheduled time.',
          rowIndex: 4,
        },
      ],
      fetchedAt,
      sourceUpdatedAt: null,
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.warnings).toHaveLength(1);
  });

  it('represents timeout as a retryable failure without invented flights', () => {
    const result = FlightSourceFetchResultSchema.parse({
      status: 'FAILED',
      flights: [],
      warnings: [],
      fetchedAt,
      sourceUpdatedAt: null,
      error: {
        code: 'TIMEOUT',
        message: 'Airport source timed out.',
        retryable: true,
      },
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      flights: [],
      error: { code: 'TIMEOUT', retryable: true },
    });
  });

  it('represents a malformed upstream document as an explicit failure', () => {
    const result = FlightSourceFetchResultSchema.parse({
      status: 'FAILED',
      flights: [],
      warnings: [],
      fetchedAt,
      sourceUpdatedAt: null,
      error: {
        code: 'MALFORMED_RESPONSE',
        message: 'Airport response did not contain a flight board.',
        retryable: false,
      },
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      error: { code: 'MALFORMED_RESPONSE', retryable: false },
    });
  });

  it('rejects malformed adapter responses at the package boundary', () => {
    const malformed = FlightSourceFetchResultSchema.safeParse({
      status: 'COMPLETE',
      flights: [{ ...normalizedFlight, flightNumber: 862 }],
      warnings: [],
      fetchedAt: 'not-a-date',
      sourceUpdatedAt: null,
    });

    expect(malformed.success).toBe(false);
  });

  it('keeps raw airport rows separate from normalized flights', () => {
    const raw: RawAirportFlight = {
      direction: 'ARRIVAL',
      flightNumberText: 'NX 861',
      scheduledDateText: '22/09/2026',
      scheduledTimeText: '10:35',
      estimatedTimeText: null,
      actualTimeText: null,
      airportText: 'Tokyo Narita',
      statusText: 'Scheduled',
      gateText: null,
      sourceUpdatedAtText: null,
    };

    expect(raw.flightNumberText).toBe('NX 861');
    expectTypeOf(raw).not.toEqualTypeOf<NormalizedFlight>();
  });

  it('defines an adapter that returns only the source contract', async () => {
    const expected: FlightSourceFetchResult = {
      status: 'COMPLETE',
      flights: [normalizedFlight],
      warnings: [],
      fetchedAt,
      sourceUpdatedAt: null,
    };
    const adapter: FlightSourceAdapter = {
      fetchFlights: () => Promise.resolve(expected),
    };

    await expect(
      adapter.fetchFlights({
        serviceDate: '2026-09-22',
        directions: ['DEPARTURE', 'ARRIVAL'],
      }),
    ).resolves.toEqual(expected);
  });
});

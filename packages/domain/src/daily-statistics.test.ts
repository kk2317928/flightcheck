import { describe, expect, it } from 'vitest';

import { aggregateDailyStatistics } from './daily-statistics.js';

type Direction = 'DEPARTURE' | 'ARRIVAL';
type Performance =
  'PENDING' | 'ON_TIME' | 'DELAYED' | 'SEVERE_DELAY' | 'UNKNOWN';
type Operational =
  | 'SCHEDULED'
  | 'DEPARTED'
  | 'ARRIVED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'RECOVERED'
  | 'DIVERTED'
  | 'UNKNOWN';

function flight(
  direction: Direction,
  performanceStatus: Performance,
  operationalStatus: Operational,
  delayMinutes: number | null,
) {
  return {
    direction,
    performanceStatus,
    operationalStatus,
    delayMinutes,
  };
}

describe('aggregateDailyStatistics', () => {
  it('excludes pending flights from punctuality while retaining cancellations in total', () => {
    const result = aggregateDailyStatistics({
      serviceDate: '2026-09-22',
      cutoffAt: new Date('2026-09-22T15:30:00.000Z'),
      flights: [
        flight('DEPARTURE', 'ON_TIME', 'SCHEDULED', 0),
        flight('ARRIVAL', 'DELAYED', 'ARRIVED', 30),
        flight('DEPARTURE', 'PENDING', 'CANCELLED', null),
      ],
    });

    expect(result).toMatchObject({
      totalFlights: 3,
      departureFlights: 2,
      arrivalFlights: 1,
      determinedFlights: 2,
      pendingFlights: 1,
      onTimeFlights: 1,
      delayedFlights: 1,
      severeDelayedFlights: 0,
      cancelledFlights: 1,
      unknownFlights: 0,
      onTimeRate: 0.5,
      cancellationRate: 1 / 3,
      averageDelayMinutes: 15,
    });
  });

  it('counts severe delay separately and treats unknown performance as undetermined', () => {
    const result = aggregateDailyStatistics({
      serviceDate: '2026-09-22',
      cutoffAt: new Date('2026-09-22T15:30:00.000Z'),
      flights: [
        flight('ARRIVAL', 'SEVERE_DELAY', 'ARRIVED', 75),
        flight('ARRIVAL', 'UNKNOWN', 'UNKNOWN', null),
      ],
    });

    expect(result).toMatchObject({
      totalFlights: 2,
      determinedFlights: 1,
      pendingFlights: 1,
      severeDelayedFlights: 1,
      unknownFlights: 1,
      onTimeRate: 0,
      averageDelayMinutes: 75,
    });
  });

  it('returns null rates when no denominator exists', () => {
    const result = aggregateDailyStatistics({
      serviceDate: '2026-09-22',
      cutoffAt: new Date('2026-09-22T15:30:00.000Z'),
      flights: [],
    });

    expect(result.cancellationRate).toBeNull();
    expect(result.onTimeRate).toBeNull();
    expect(result.averageDelayMinutes).toBeNull();
  });
});

import type { NormalizedFlight } from '@flightcheck/flight-source';
import { describe, expect, it } from 'vitest';

import { evaluatePerformanceStatus } from './performance-status.js';

const scheduledAt = new Date('2026-09-22T08:00:00.000Z');

function flight(overrides: Partial<NormalizedFlight> = {}): NormalizedFlight {
  return {
    flightNumber: 'NX001',
    serviceDate: '2026-09-22',
    direction: 'DEPARTURE',
    scheduledAt,
    estimatedAt: null,
    actualAt: null,
    origin: { code: 'MFM', name: 'Macau' },
    destination: { code: 'TPE', name: 'Taipei' },
    sourceStatus: 'SCHEDULED',
    rawStatus: 'Scheduled',
    ...overrides,
  };
}

describe('evaluatePerformanceStatus', () => {
  it.each([
    ['14 minutes', '2026-09-22T08:14:00.000Z', 'ON_TIME', 14],
    ['15 minutes', '2026-09-22T08:15:00.000Z', 'DELAYED', 15],
    ['59 minutes', '2026-09-22T08:59:00.000Z', 'DELAYED', 59],
    ['60 minutes', '2026-09-22T09:00:00.000Z', 'SEVERE_DELAY', 60],
  ] as const)('classifies %s', (_, estimatedAt, status, minutes) => {
    expect(
      evaluatePerformanceStatus(flight({ estimatedAt: new Date(estimatedAt) })),
    ).toEqual({
      performanceStatus: status,
      delayMinutes: minutes,
      scheduleVarianceMinutes: minutes,
    });
  });

  it.each([
    ['2026-09-22T08:14:59.999Z', 'ON_TIME', 14],
    ['2026-09-22T08:59:59.999Z', 'DELAYED', 59],
  ] as const)(
    'truncates sub-minute variance for %s',
    (instant, status, minutes) => {
      expect(
        evaluatePerformanceStatus(flight({ estimatedAt: new Date(instant) })),
      ).toEqual({
        performanceStatus: status,
        delayMinutes: minutes,
        scheduleVarianceMinutes: minutes,
      });
    },
  );

  it('keeps an unestimated known flight pending', () => {
    expect(evaluatePerformanceStatus(flight())).toEqual({
      performanceStatus: 'PENDING',
      delayMinutes: null,
      scheduleVarianceMinutes: null,
    });
  });

  it('marks an unestimated unknown observation as unknown', () => {
    expect(
      evaluatePerformanceStatus(flight({ sourceStatus: 'UNKNOWN' })),
    ).toEqual({
      performanceStatus: 'UNKNOWN',
      delayMinutes: null,
      scheduleVarianceMinutes: null,
    });
  });

  it('preserves early variance while clamping delay to zero', () => {
    expect(
      evaluatePerformanceStatus(
        flight({ estimatedAt: new Date('2026-09-22T07:55:00.000Z') }),
      ),
    ).toEqual({
      performanceStatus: 'ON_TIME',
      delayMinutes: 0,
      scheduleVarianceMinutes: -5,
    });
  });

  it('uses actual time instead of a later estimate', () => {
    expect(
      evaluatePerformanceStatus(
        flight({
          estimatedAt: new Date('2026-09-22T08:20:00.000Z'),
          actualAt: new Date('2026-09-22T07:55:00.000Z'),
        }),
      ),
    ).toEqual({
      performanceStatus: 'ON_TIME',
      delayMinutes: 0,
      scheduleVarianceMinutes: -5,
    });
  });

  it.each([
    { scheduledAt: new Date(Number.NaN) },
    { estimatedAt: new Date(Number.NaN) },
    { actualAt: new Date(Number.NaN) },
  ])('rejects invalid flight dates: $overrides', (overrides) => {
    expect(() => evaluatePerformanceStatus(flight(overrides))).toThrow(
      /invalid flight time/i,
    );
  });
});

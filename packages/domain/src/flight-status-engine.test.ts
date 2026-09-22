import type { NormalizedFlight } from '@flightcheck/flight-source';
import { describe, expect, it, vi } from 'vitest';

import {
  applyFlightStatusObservation,
  type ApplyFlightStatusObservationInput,
  type FlightStatusTransitionWriter,
} from './flight-status-engine.js';
import type { FlightStatusState } from './status-types.js';

const current: FlightStatusState = {
  operationalStatus: 'SCHEDULED',
  performanceStatus: 'PENDING',
  delayMinutes: null,
  scheduleVarianceMinutes: null,
  cancelledObservedCount: 0,
  cancelConfirmedAt: null,
  lastStatusObservedAt: null,
};

function flight(overrides: Partial<NormalizedFlight> = {}): NormalizedFlight {
  return {
    flightNumber: 'NX001',
    serviceDate: '2026-09-22',
    direction: 'DEPARTURE',
    scheduledAt: new Date('2026-09-22T08:00:00.000Z'),
    estimatedAt: null,
    actualAt: null,
    origin: { code: 'MFM', name: 'Macau' },
    destination: { code: 'TPE', name: 'Taipei' },
    sourceStatus: 'SCHEDULED',
    rawStatus: 'Scheduled',
    ...overrides,
  };
}

function input(
  writer: FlightStatusTransitionWriter,
  overrides: Partial<ApplyFlightStatusObservationInput> = {},
): ApplyFlightStatusObservationInput {
  return {
    flightInstanceId: 'instance-1',
    current,
    observation: flight(),
    observedAt: new Date('2026-09-22T08:05:00.000Z'),
    writer,
    ...overrides,
  };
}

describe('applyFlightStatusObservation', () => {
  it('submits the complete expected and target policy state', async () => {
    const recordStatusTransition = vi.fn().mockResolvedValue({ changed: true });
    const writer = { recordStatusTransition };
    const observedAt = new Date('2026-09-22T08:05:00.000Z');

    const result = await applyFlightStatusObservation(
      input(writer, {
        observedAt,
        observation: flight({
          sourceStatus: 'CANCELLED',
          rawStatus: 'Cancelled',
          estimatedAt: new Date('2026-09-22T08:20:00.000Z'),
        }),
      }),
    );

    expect(recordStatusTransition).toHaveBeenCalledOnce();
    expect(recordStatusTransition).toHaveBeenCalledWith({
      flightInstanceId: 'instance-1',
      expectedOperationalStatus: 'SCHEDULED',
      expectedPerformanceStatus: 'PENDING',
      expectedDelayMinutes: null,
      expectedScheduleVarianceMinutes: null,
      expectedCancelledObservedCount: 0,
      expectedCancelConfirmedAt: null,
      expectedLastStatusObservedAt: null,
      operationalStatus: 'CANCEL_PENDING',
      performanceStatus: 'DELAYED',
      delayMinutes: 20,
      scheduleVarianceMinutes: 20,
      cancelledObservedCount: 1,
      cancelConfirmedAt: null,
      lastStatusObservedAt: observedAt,
      reason: 'FIRST_CANCELLATION_OBSERVATION',
      observedAt,
    });
    expect(result).toEqual({
      changed: true,
      decision: {
        operationalStatus: 'CANCEL_PENDING',
        performanceStatus: 'DELAYED',
        delayMinutes: 20,
        scheduleVarianceMinutes: 20,
        cancelledObservedCount: 1,
        cancelConfirmedAt: null,
        lastStatusObservedAt: observedAt,
        reason: 'FIRST_CANCELLATION_OBSERVATION',
      },
    });
  });

  it('keeps terminal operation while actual time replaces estimated performance', async () => {
    const writer: FlightStatusTransitionWriter = {
      recordStatusTransition: vi.fn().mockResolvedValue({ changed: true }),
    };
    const result = await applyFlightStatusObservation(
      input(writer, {
        current: {
          ...current,
          operationalStatus: 'DEPARTED',
          performanceStatus: 'DELAYED',
          delayMinutes: 20,
          scheduleVarianceMinutes: 20,
        },
        observation: flight({
          sourceStatus: 'SCHEDULED',
          estimatedAt: new Date('2026-09-22T08:20:00.000Z'),
          actualAt: new Date('2026-09-22T07:55:00.000Z'),
        }),
      }),
    );

    expect(result.decision).toMatchObject({
      operationalStatus: 'DEPARTED',
      performanceStatus: 'ON_TIME',
      delayMinutes: 0,
      scheduleVarianceMinutes: -5,
      reason: 'TERMINAL_REGRESSION_BLOCKED',
    });
  });

  it('does not erase terminal performance with weaker timing evidence', async () => {
    const writer: FlightStatusTransitionWriter = {
      recordStatusTransition: vi.fn().mockResolvedValue({ changed: true }),
    };
    const result = await applyFlightStatusObservation(
      input(writer, {
        current: {
          ...current,
          operationalStatus: 'ARRIVED',
          performanceStatus: 'DELAYED',
          delayMinutes: 30,
          scheduleVarianceMinutes: 30,
        },
        observation: flight({ sourceStatus: 'UNKNOWN' }),
      }),
    );

    expect(result.decision).toMatchObject({
      operationalStatus: 'ARRIVED',
      performanceStatus: 'DELAYED',
      delayMinutes: 30,
      scheduleVarianceMinutes: 30,
    });
  });

  it('preserves a transition-writer error for stale-policy retry', async () => {
    const stale = new Error('Stale status transition');
    const writer: FlightStatusTransitionWriter = {
      recordStatusTransition: vi.fn().mockRejectedValue(stale),
    };

    await expect(applyFlightStatusObservation(input(writer))).rejects.toBe(
      stale,
    );
  });

  it('does not invent observations for a missing row', async () => {
    const recordStatusTransition = vi.fn();
    const writer = { recordStatusTransition };
    const observations: NormalizedFlight[] = [];

    for (const observation of observations) {
      await applyFlightStatusObservation(input(writer, { observation }));
    }

    expect(recordStatusTransition).not.toHaveBeenCalled();
  });
});

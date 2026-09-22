import { describe, expect, it } from 'vitest';

import { evaluateOperationalStatus } from './operational-status.js';
import type { FlightStatusState, OperationalStatus } from './status-types.js';

const initial: FlightStatusState = {
  operationalStatus: 'SCHEDULED',
  performanceStatus: 'PENDING',
  delayMinutes: null,
  scheduleVarianceMinutes: null,
  cancelledObservedCount: 0,
  cancelConfirmedAt: null,
  lastStatusObservedAt: null,
};

function at(time: string): Date {
  return new Date(`2026-09-22T${time}:00.000Z`);
}

describe('evaluateOperationalStatus', () => {
  it.each([
    ['SCHEDULED', 'SCHEDULED'],
    ['DELAYED', 'SCHEDULED'],
    ['DEPARTED', 'DEPARTED'],
    ['ARRIVED', 'ARRIVED'],
    ['DIVERTED', 'DIVERTED'],
    ['UNKNOWN', 'UNKNOWN'],
  ] as const)('maps source %s to %s', (sourceStatus, operationalStatus) => {
    expect(
      evaluateOperationalStatus(initial, sourceStatus, at('08:05')),
    ).toMatchObject({
      operationalStatus,
      cancelledObservedCount: 0,
      cancelConfirmedAt: null,
      reason: 'SOURCE_STATUS',
    });
  });

  it('requires two consecutive explicit cancellations', () => {
    const first = evaluateOperationalStatus(initial, 'CANCELLED', at('08:05'));
    expect(first).toMatchObject({
      operationalStatus: 'CANCEL_PENDING',
      cancelledObservedCount: 1,
      cancelConfirmedAt: null,
      reason: 'FIRST_CANCELLATION_OBSERVATION',
    });

    const second = evaluateOperationalStatus(
      { ...initial, ...first },
      'CANCELLED',
      at('08:10'),
    );
    expect(second).toMatchObject({
      operationalStatus: 'CANCELLED',
      cancelledObservedCount: 2,
      cancelConfirmedAt: at('08:10'),
      reason: 'CANCELLATION_CONFIRMED',
    });
  });

  it('does not count a replayed observation as a second cancellation', () => {
    const first = evaluateOperationalStatus(initial, 'CANCELLED', at('08:05'));

    expect(
      evaluateOperationalStatus(
        { ...initial, ...first },
        'CANCELLED',
        at('08:05'),
      ),
    ).toMatchObject({
      operationalStatus: 'CANCEL_PENDING',
      cancelledObservedCount: 1,
      reason: 'OBSERVATION_REPLAY',
      lastStatusObservedAt: at('08:05'),
    });
  });

  it.each(['SCHEDULED', 'DELAYED', 'UNKNOWN'] as const)(
    'restores recovery when recancellation is interrupted by %s',
    (sourceStatus) => {
      const confirmedAt = at('08:10');
      expect(
        evaluateOperationalStatus(
          {
            ...initial,
            operationalStatus: 'CANCEL_PENDING',
            cancelledObservedCount: 1,
            cancelConfirmedAt: confirmedAt,
            lastStatusObservedAt: at('08:20'),
          },
          sourceStatus,
          at('08:25'),
        ),
      ).toMatchObject({
        operationalStatus: 'RECOVERED',
        cancelledObservedCount: 0,
        cancelConfirmedAt: confirmedAt,
        reason: 'RECOVERY_RETAINED',
      });
    },
  );

  it.each(['DEPARTED', 'ARRIVED', 'DIVERTED'] as const)(
    'advances an interrupted recancellation to terminal %s',
    (sourceStatus) => {
      const confirmedAt = at('08:10');
      expect(
        evaluateOperationalStatus(
          {
            ...initial,
            operationalStatus: 'CANCEL_PENDING',
            cancelledObservedCount: 1,
            cancelConfirmedAt: confirmedAt,
            lastStatusObservedAt: at('08:20'),
          },
          sourceStatus,
          at('08:25'),
        ),
      ).toMatchObject({
        operationalStatus: sourceStatus,
        cancelledObservedCount: 0,
        cancelConfirmedAt: confirmedAt,
        reason: 'TERMINAL_ADVANCE',
      });
    },
  );

  it('restarts confirmation after an unknown observation interrupts it', () => {
    const first = evaluateOperationalStatus(initial, 'CANCELLED', at('08:05'));
    const interrupted = evaluateOperationalStatus(
      { ...initial, ...first },
      'UNKNOWN',
      at('08:10'),
    );
    expect(interrupted).toMatchObject({
      operationalStatus: 'UNKNOWN',
      cancelledObservedCount: 0,
      cancelConfirmedAt: null,
      reason: 'CANCELLATION_SEQUENCE_RESET',
    });
    expect(
      evaluateOperationalStatus(
        { ...initial, ...interrupted },
        'CANCELLED',
        at('08:15'),
      ),
    ).toMatchObject({
      operationalStatus: 'CANCEL_PENDING',
      cancelledObservedCount: 1,
      reason: 'FIRST_CANCELLATION_OBSERVATION',
    });
  });

  it('replays a confirmed cancellation without replacing its confirmation time', () => {
    const confirmedAt = at('08:10');
    expect(
      evaluateOperationalStatus(
        {
          ...initial,
          operationalStatus: 'CANCELLED',
          cancelledObservedCount: 2,
          cancelConfirmedAt: confirmedAt,
        },
        'CANCELLED',
        at('08:15'),
      ),
    ).toMatchObject({
      operationalStatus: 'CANCELLED',
      cancelledObservedCount: 2,
      cancelConfirmedAt: confirmedAt,
      reason: 'CANCELLATION_REPLAY',
    });
  });

  it('recovers a confirmed cancellation and retains historical confirmation', () => {
    const confirmedAt = at('08:10');
    expect(
      evaluateOperationalStatus(
        {
          ...initial,
          operationalStatus: 'CANCELLED',
          cancelledObservedCount: 2,
          cancelConfirmedAt: confirmedAt,
        },
        'SCHEDULED',
        at('08:15'),
      ),
    ).toMatchObject({
      operationalStatus: 'RECOVERED',
      cancelledObservedCount: 0,
      cancelConfirmedAt: confirmedAt,
      reason: 'CANCELLATION_RECOVERED',
    });
  });

  it.each(['SCHEDULED', 'DELAYED', 'UNKNOWN'] as const)(
    'retains recovery for weak source status %s',
    (sourceStatus) => {
      const confirmedAt = at('08:10');
      expect(
        evaluateOperationalStatus(
          {
            ...initial,
            operationalStatus: 'RECOVERED',
            cancelConfirmedAt: confirmedAt,
          },
          sourceStatus,
          at('08:20'),
        ),
      ).toMatchObject({
        operationalStatus: 'RECOVERED',
        cancelledObservedCount: 0,
        cancelConfirmedAt: confirmedAt,
        reason: 'RECOVERY_RETAINED',
      });
    },
  );

  it.each(['DEPARTED', 'ARRIVED', 'DIVERTED'] as const)(
    'advances recovered flight to terminal %s',
    (sourceStatus) => {
      const confirmedAt = at('08:10');
      expect(
        evaluateOperationalStatus(
          {
            ...initial,
            operationalStatus: 'RECOVERED',
            cancelConfirmedAt: confirmedAt,
          },
          sourceStatus,
          at('08:20'),
        ),
      ).toMatchObject({
        operationalStatus: sourceStatus,
        cancelledObservedCount: 0,
        cancelConfirmedAt: confirmedAt,
        reason: 'TERMINAL_ADVANCE',
      });
    },
  );

  it('starts a fresh cancellation sequence after recovery', () => {
    const confirmedAt = at('08:10');
    expect(
      evaluateOperationalStatus(
        {
          ...initial,
          operationalStatus: 'RECOVERED',
          cancelConfirmedAt: confirmedAt,
        },
        'CANCELLED',
        at('08:20'),
      ),
    ).toMatchObject({
      operationalStatus: 'CANCEL_PENDING',
      cancelledObservedCount: 1,
      cancelConfirmedAt: confirmedAt,
      reason: 'FIRST_CANCELLATION_OBSERVATION',
    });
  });

  it('allows departed to advance to arrived', () => {
    expect(
      evaluateOperationalStatus(
        { ...initial, operationalStatus: 'DEPARTED' },
        'ARRIVED',
        at('08:20'),
      ),
    ).toMatchObject({
      operationalStatus: 'ARRIVED',
      reason: 'TERMINAL_ADVANCE',
    });
  });

  it.each(['DEPARTED', 'ARRIVED', 'DIVERTED'] as const)(
    'blocks weak observations after terminal %s',
    (operationalStatus) => {
      for (const sourceStatus of [
        'SCHEDULED',
        'DELAYED',
        'UNKNOWN',
        'CANCELLED',
      ] as const) {
        expect(
          evaluateOperationalStatus(
            { ...initial, operationalStatus },
            sourceStatus,
            at('08:20'),
          ),
        ).toMatchObject({
          operationalStatus,
          cancelledObservedCount: 0,
          cancelConfirmedAt: null,
          reason: 'TERMINAL_REGRESSION_BLOCKED',
        });
      }
    },
  );

  it.each([
    { cancelledObservedCount: -1 },
    { cancelledObservedCount: 0.5 },
    {
      operationalStatus: 'CANCELLED' as OperationalStatus,
      cancelledObservedCount: 2,
      cancelConfirmedAt: null,
    },
    {
      operationalStatus: 'CANCELLED' as OperationalStatus,
      cancelledObservedCount: 0,
      cancelConfirmedAt: at('08:10'),
    },
    {
      operationalStatus: 'CANCELLED' as OperationalStatus,
      cancelledObservedCount: 2,
      cancelConfirmedAt: new Date(Number.NaN),
    },
  ])('rejects inconsistent current state: $overrides', (overrides) => {
    expect(() =>
      evaluateOperationalStatus(
        { ...initial, ...overrides },
        'SCHEDULED',
        at('08:20'),
      ),
    ).toThrow();
  });

  it('rejects an invalid observation time', () => {
    expect(() =>
      evaluateOperationalStatus(initial, 'SCHEDULED', new Date(Number.NaN)),
    ).toThrow(/invalid observation time/i);
  });
});

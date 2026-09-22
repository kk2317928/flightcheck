import type { SourceFlightStatus } from '@flightcheck/flight-source';

import type {
  FlightStatusState,
  OperationalDecision,
  OperationalStatus,
} from './status-types.js';

const TERMINAL = new Set<OperationalStatus>([
  'DEPARTED',
  'ARRIVED',
  'DIVERTED',
]);

function assertCurrentState(current: FlightStatusState): void {
  if (
    !Number.isInteger(current.cancelledObservedCount) ||
    current.cancelledObservedCount < 0
  ) {
    throw new TypeError('Invalid cancellation observation count');
  }
  if (
    current.operationalStatus === 'CANCELLED' &&
    current.cancelConfirmedAt === null
  ) {
    throw new TypeError('Confirmed cancellation requires cancelConfirmedAt');
  }
}

function mapSourceStatus(
  sourceStatus: Exclude<SourceFlightStatus, 'CANCELLED'>,
): OperationalStatus {
  if (sourceStatus === 'DELAYED') return 'SCHEDULED';
  return sourceStatus;
}

function decision(
  current: FlightStatusState,
  operationalStatus: OperationalStatus,
  reason: OperationalDecision['reason'],
  overrides: Partial<
    Pick<OperationalDecision, 'cancelledObservedCount' | 'cancelConfirmedAt'>
  > = {},
): OperationalDecision {
  return {
    operationalStatus,
    cancelledObservedCount:
      overrides.cancelledObservedCount ?? current.cancelledObservedCount,
    cancelConfirmedAt:
      overrides.cancelConfirmedAt === undefined
        ? current.cancelConfirmedAt
        : overrides.cancelConfirmedAt,
    reason,
  };
}

export function evaluateOperationalStatus(
  current: FlightStatusState,
  sourceStatus: SourceFlightStatus,
  observedAt: Date,
): OperationalDecision {
  assertCurrentState(current);
  if (!Number.isFinite(observedAt.getTime())) {
    throw new TypeError('Invalid observation time');
  }

  if (TERMINAL.has(current.operationalStatus)) {
    if (
      current.operationalStatus === 'DEPARTED' &&
      sourceStatus === 'ARRIVED'
    ) {
      return decision(current, 'ARRIVED', 'TERMINAL_ADVANCE');
    }
    if (
      sourceStatus !== 'CANCELLED' &&
      mapSourceStatus(sourceStatus) === current.operationalStatus
    ) {
      return decision(current, current.operationalStatus, 'SOURCE_STATUS');
    }
    return decision(
      current,
      current.operationalStatus,
      'TERMINAL_REGRESSION_BLOCKED',
    );
  }

  if (current.operationalStatus === 'CANCELLED') {
    if (sourceStatus === 'CANCELLED') {
      return decision(current, 'CANCELLED', 'CANCELLATION_REPLAY');
    }
    return decision(current, 'RECOVERED', 'CANCELLATION_RECOVERED', {
      cancelledObservedCount: 0,
    });
  }

  if (current.operationalStatus === 'RECOVERED') {
    if (sourceStatus === 'CANCELLED') {
      return decision(
        current,
        'CANCEL_PENDING',
        'FIRST_CANCELLATION_OBSERVATION',
        { cancelledObservedCount: 1 },
      );
    }
    const mapped = mapSourceStatus(sourceStatus);
    if (TERMINAL.has(mapped)) {
      return decision(current, mapped, 'TERMINAL_ADVANCE', {
        cancelledObservedCount: 0,
      });
    }
    return decision(current, 'RECOVERED', 'RECOVERY_RETAINED', {
      cancelledObservedCount: 0,
    });
  }

  if (sourceStatus === 'CANCELLED') {
    if (
      current.operationalStatus === 'CANCEL_PENDING' &&
      current.cancelledObservedCount >= 1
    ) {
      return decision(current, 'CANCELLED', 'CANCELLATION_CONFIRMED', {
        cancelledObservedCount: 2,
        cancelConfirmedAt: observedAt,
      });
    }
    return decision(
      current,
      'CANCEL_PENDING',
      'FIRST_CANCELLATION_OBSERVATION',
      { cancelledObservedCount: 1 },
    );
  }

  const wasPending =
    current.operationalStatus === 'CANCEL_PENDING' ||
    current.cancelledObservedCount > 0;
  return decision(
    current,
    mapSourceStatus(sourceStatus),
    wasPending ? 'CANCELLATION_SEQUENCE_RESET' : 'SOURCE_STATUS',
    { cancelledObservedCount: 0 },
  );
}

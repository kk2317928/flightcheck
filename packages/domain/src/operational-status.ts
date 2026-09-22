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
    (current.cancelledObservedCount !== 2 ||
      current.cancelConfirmedAt === null ||
      !Number.isFinite(current.cancelConfirmedAt.getTime()))
  ) {
    throw new TypeError('Invalid confirmed cancellation state');
  }
  if (
    current.lastStatusObservedAt !== null &&
    !Number.isFinite(current.lastStatusObservedAt.getTime())
  ) {
    throw new TypeError('Invalid last status observation time');
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
    lastStatusObservedAt: current.lastStatusObservedAt ?? new Date(0),
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
  if (
    current.lastStatusObservedAt !== null &&
    observedAt.getTime() <= current.lastStatusObservedAt.getTime()
  ) {
    return {
      operationalStatus: current.operationalStatus,
      cancelledObservedCount: current.cancelledObservedCount,
      cancelConfirmedAt: current.cancelConfirmedAt,
      reason: 'OBSERVATION_REPLAY',
      lastStatusObservedAt: current.lastStatusObservedAt,
    };
  }

  const observedDecision = (
    value: Omit<OperationalDecision, 'lastStatusObservedAt'> & {
      lastStatusObservedAt: Date;
    },
  ): OperationalDecision => ({ ...value, lastStatusObservedAt: observedAt });

  if (TERMINAL.has(current.operationalStatus)) {
    if (
      current.operationalStatus === 'DEPARTED' &&
      sourceStatus === 'ARRIVED'
    ) {
      return observedDecision(decision(current, 'ARRIVED', 'TERMINAL_ADVANCE'));
    }
    if (
      sourceStatus !== 'CANCELLED' &&
      mapSourceStatus(sourceStatus) === current.operationalStatus
    ) {
      return observedDecision(
        decision(current, current.operationalStatus, 'SOURCE_STATUS'),
      );
    }
    return observedDecision(
      decision(
        current,
        current.operationalStatus,
        'TERMINAL_REGRESSION_BLOCKED',
      ),
    );
  }

  if (current.operationalStatus === 'CANCELLED') {
    if (sourceStatus === 'CANCELLED') {
      return observedDecision(
        decision(current, 'CANCELLED', 'CANCELLATION_REPLAY'),
      );
    }
    return observedDecision(
      decision(current, 'RECOVERED', 'CANCELLATION_RECOVERED', {
        cancelledObservedCount: 0,
      }),
    );
  }

  if (current.operationalStatus === 'RECOVERED') {
    if (sourceStatus === 'CANCELLED') {
      return observedDecision(
        decision(current, 'CANCEL_PENDING', 'FIRST_CANCELLATION_OBSERVATION', {
          cancelledObservedCount: 1,
        }),
      );
    }
    const mapped = mapSourceStatus(sourceStatus);
    if (TERMINAL.has(mapped)) {
      return observedDecision(
        decision(current, mapped, 'TERMINAL_ADVANCE', {
          cancelledObservedCount: 0,
        }),
      );
    }
    return observedDecision(
      decision(current, 'RECOVERED', 'RECOVERY_RETAINED', {
        cancelledObservedCount: 0,
      }),
    );
  }

  if (sourceStatus === 'CANCELLED') {
    if (
      current.operationalStatus === 'CANCEL_PENDING' &&
      current.cancelledObservedCount >= 1
    ) {
      return observedDecision(
        decision(current, 'CANCELLED', 'CANCELLATION_CONFIRMED', {
          cancelledObservedCount: 2,
          cancelConfirmedAt: observedAt,
        }),
      );
    }
    return observedDecision(
      decision(current, 'CANCEL_PENDING', 'FIRST_CANCELLATION_OBSERVATION', {
        cancelledObservedCount: 1,
      }),
    );
  }

  if (
    current.operationalStatus === 'CANCEL_PENDING' &&
    current.cancelConfirmedAt !== null
  ) {
    const mapped = mapSourceStatus(sourceStatus);
    if (TERMINAL.has(mapped)) {
      return observedDecision(
        decision(current, mapped, 'TERMINAL_ADVANCE', {
          cancelledObservedCount: 0,
        }),
      );
    }
    return observedDecision(
      decision(current, 'RECOVERED', 'RECOVERY_RETAINED', {
        cancelledObservedCount: 0,
      }),
    );
  }

  const wasPending =
    current.operationalStatus === 'CANCEL_PENDING' ||
    current.cancelledObservedCount > 0;
  return observedDecision(
    decision(
      current,
      mapSourceStatus(sourceStatus),
      wasPending ? 'CANCELLATION_SEQUENCE_RESET' : 'SOURCE_STATUS',
      { cancelledObservedCount: 0 },
    ),
  );
}

import type { NormalizedFlight } from '@flightcheck/flight-source';

import type { PerformanceDecision } from './status-types.js';

const MINUTE_MS = 60_000;

export function evaluatePerformanceStatus(
  observation: NormalizedFlight,
): PerformanceDecision {
  const scheduledTime = observation.scheduledAt.getTime();
  if (!Number.isFinite(scheduledTime)) {
    throw new TypeError('Invalid flight time');
  }

  const reference = observation.actualAt ?? observation.estimatedAt;
  if (reference === null) {
    return {
      performanceStatus:
        observation.sourceStatus === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING',
      delayMinutes: null,
      scheduleVarianceMinutes: null,
    };
  }

  const difference = reference.getTime() - scheduledTime;
  if (!Number.isFinite(difference)) {
    throw new TypeError('Invalid flight time');
  }

  const scheduleVarianceMinutes = Math.trunc(difference / MINUTE_MS);
  const delayMinutes = Math.max(0, scheduleVarianceMinutes);
  const performanceStatus =
    delayMinutes >= 60
      ? 'SEVERE_DELAY'
      : delayMinutes >= 15
        ? 'DELAYED'
        : 'ON_TIME';

  return { performanceStatus, delayMinutes, scheduleVarianceMinutes };
}

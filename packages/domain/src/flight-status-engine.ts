import type { NormalizedFlight } from '@flightcheck/flight-source';

import { evaluateOperationalStatus } from './operational-status.js';
import { evaluatePerformanceStatus } from './performance-status.js';
import type {
  FlightStatusState,
  OperationalStatus,
  PerformanceStatus,
  StatusReason,
} from './status-types.js';

export interface FlightStatusTransitionWriter {
  recordStatusTransition(input: {
    flightInstanceId: string;
    expectedOperationalStatus: OperationalStatus;
    expectedPerformanceStatus: PerformanceStatus;
    expectedDelayMinutes: number | null;
    expectedScheduleVarianceMinutes: number | null;
    expectedCancelledObservedCount: number;
    expectedCancelConfirmedAt: Date | null;
    expectedLastStatusObservedAt: Date | null;
    operationalStatus: OperationalStatus;
    performanceStatus: PerformanceStatus;
    delayMinutes: number | null;
    scheduleVarianceMinutes: number | null;
    cancelledObservedCount: number;
    cancelConfirmedAt: Date | null;
    lastStatusObservedAt: Date;
    reason: StatusReason;
    observedAt: Date;
  }): Promise<{ changed: boolean }>;
}

export interface ApplyFlightStatusObservationInput {
  flightInstanceId: string;
  current: FlightStatusState;
  observation: NormalizedFlight;
  observedAt: Date;
  writer: FlightStatusTransitionWriter;
}

export interface FlightStatusDecision extends FlightStatusState {
  reason: StatusReason;
}

export interface StatusApplicationResult {
  changed: boolean;
  decision: FlightStatusDecision;
}

export async function applyFlightStatusObservation(
  input: ApplyFlightStatusObservationInput,
): Promise<StatusApplicationResult> {
  const operational = evaluateOperationalStatus(
    input.current,
    input.observation.sourceStatus,
    input.observedAt,
  );
  const evaluatedPerformance = evaluatePerformanceStatus(input.observation);
  const preservesCurrentPerformance =
    operational.reason === 'OBSERVATION_REPLAY' ||
    (['DEPARTED', 'ARRIVED', 'DIVERTED'].includes(
      input.current.operationalStatus,
    ) &&
      input.observation.actualAt === null);
  const performance = preservesCurrentPerformance
    ? {
        performanceStatus: input.current.performanceStatus,
        delayMinutes: input.current.delayMinutes,
        scheduleVarianceMinutes: input.current.scheduleVarianceMinutes,
      }
    : evaluatedPerformance;
  const decision: FlightStatusDecision = {
    ...input.current,
    ...operational,
    ...performance,
    lastStatusObservedAt: operational.lastStatusObservedAt,
  };

  const result = await input.writer.recordStatusTransition({
    flightInstanceId: input.flightInstanceId,
    expectedOperationalStatus: input.current.operationalStatus,
    expectedPerformanceStatus: input.current.performanceStatus,
    expectedDelayMinutes: input.current.delayMinutes,
    expectedScheduleVarianceMinutes: input.current.scheduleVarianceMinutes,
    expectedCancelledObservedCount: input.current.cancelledObservedCount,
    expectedCancelConfirmedAt: input.current.cancelConfirmedAt,
    expectedLastStatusObservedAt: input.current.lastStatusObservedAt,
    operationalStatus: decision.operationalStatus,
    performanceStatus: decision.performanceStatus,
    delayMinutes: decision.delayMinutes,
    scheduleVarianceMinutes: decision.scheduleVarianceMinutes,
    cancelledObservedCount: decision.cancelledObservedCount,
    cancelConfirmedAt: decision.cancelConfirmedAt,
    lastStatusObservedAt: operational.lastStatusObservedAt,
    reason: decision.reason,
    observedAt: input.observedAt,
  });

  return { ...result, decision };
}

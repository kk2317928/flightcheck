export type OperationalStatus =
  | 'SCHEDULED'
  | 'DEPARTED'
  | 'ARRIVED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'RECOVERED'
  | 'DIVERTED'
  | 'UNKNOWN';

export type PerformanceStatus =
  'PENDING' | 'ON_TIME' | 'DELAYED' | 'SEVERE_DELAY' | 'UNKNOWN';

export interface FlightStatusState {
  operationalStatus: OperationalStatus;
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
  scheduleVarianceMinutes: number | null;
  cancelledObservedCount: number;
  cancelConfirmedAt: Date | null;
}

export interface PerformanceDecision {
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
  scheduleVarianceMinutes: number | null;
}

export type StatusReason =
  | 'SOURCE_STATUS'
  | 'FIRST_CANCELLATION_OBSERVATION'
  | 'CANCELLATION_CONFIRMED'
  | 'CANCELLATION_REPLAY'
  | 'CANCELLATION_SEQUENCE_RESET'
  | 'CANCELLATION_RECOVERED'
  | 'RECOVERY_RETAINED'
  | 'TERMINAL_ADVANCE'
  | 'TERMINAL_REGRESSION_BLOCKED';

export interface OperationalDecision {
  operationalStatus: OperationalStatus;
  cancelledObservedCount: number;
  cancelConfirmedAt: Date | null;
  reason: StatusReason;
}

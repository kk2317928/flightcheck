import type { OperationalStatus, PerformanceStatus } from './status-types.js';

export type StatisticsFlightDirection = 'DEPARTURE' | 'ARRIVAL';

export interface DailyStatisticsFlight {
  direction: StatisticsFlightDirection;
  operationalStatus: OperationalStatus;
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
}

export interface DailyStatisticsInput {
  serviceDate: string;
  cutoffAt: Date;
  flights: readonly DailyStatisticsFlight[];
}

export interface DailyStatisticsResult {
  serviceDate: string;
  cutoffAt: Date;
  totalFlights: number;
  departureFlights: number;
  arrivalFlights: number;
  determinedFlights: number;
  pendingFlights: number;
  onTimeFlights: number;
  delayedFlights: number;
  severeDelayedFlights: number;
  cancelledFlights: number;
  unknownFlights: number;
  cancellationRate: number | null;
  onTimeRate: number | null;
  averageDelayMinutes: number | null;
}

export type DataQuality = 'COMPLETE' | 'DEGRADED';

export type DataQualityReason =
  | 'MISSING_DEPARTURES'
  | 'MISSING_ARRIVALS'
  | 'STALE_DEPARTURES'
  | 'STALE_ARRIVALS'
  | 'CRITICAL_WARNING';

export interface DataQualitySourceEvidence {
  lastSuccessfulAt: Date;
  warningCount: number;
  criticalWarningCount: number;
}

export interface DataQualityInput {
  evaluatedAt: Date;
  cutoffAt: Date;
  maxAgeMinutes: number;
  departures: DataQualitySourceEvidence | null;
  arrivals: DataQualitySourceEvidence | null;
}

export interface DataQualityResult {
  quality: DataQuality;
  reasons: DataQualityReason[];
  lastSuccessfulAt: Date | null;
  warningSummary: {
    total: number;
    critical: number;
  };
  evaluatedAt: Date;
  cutoffAt: Date;
}

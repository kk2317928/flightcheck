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

import type {
  DailyStatisticsInput,
  DailyStatisticsResult,
} from './statistics-types.js';

export function aggregateDailyStatistics(
  input: DailyStatisticsInput,
): DailyStatisticsResult {
  const determined = input.flights.filter(
    (flight) =>
      flight.performanceStatus !== 'PENDING' &&
      flight.performanceStatus !== 'UNKNOWN',
  );
  const onTimeFlights = determined.filter(
    (flight) => flight.performanceStatus === 'ON_TIME',
  ).length;
  const cancelledFlights = input.flights.filter(
    (flight) => flight.operationalStatus === 'CANCELLED',
  ).length;
  const delays = determined
    .map((flight) => flight.delayMinutes)
    .filter((value): value is number => value !== null);

  return {
    serviceDate: input.serviceDate,
    cutoffAt: input.cutoffAt,
    totalFlights: input.flights.length,
    departureFlights: input.flights.filter(
      (flight) => flight.direction === 'DEPARTURE',
    ).length,
    arrivalFlights: input.flights.filter(
      (flight) => flight.direction === 'ARRIVAL',
    ).length,
    determinedFlights: determined.length,
    pendingFlights: input.flights.length - determined.length,
    onTimeFlights,
    delayedFlights: determined.filter(
      (flight) => flight.performanceStatus === 'DELAYED',
    ).length,
    severeDelayedFlights: determined.filter(
      (flight) => flight.performanceStatus === 'SEVERE_DELAY',
    ).length,
    cancelledFlights,
    unknownFlights: input.flights.filter(
      (flight) => flight.operationalStatus === 'UNKNOWN',
    ).length,
    cancellationRate:
      input.flights.length === 0
        ? null
        : cancelledFlights / input.flights.length,
    onTimeRate:
      determined.length === 0 ? null : onTimeFlights / determined.length,
    averageDelayMinutes:
      delays.length === 0
        ? null
        : delays.reduce((sum, value) => sum + value, 0) / delays.length,
  };
}

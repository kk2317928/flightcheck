import type {
  FlightQueryRepository,
  PublicFlightRecord,
} from '@flightcheck/db';
import {
  FlightDetailsQuerySchema,
  FlightListQuerySchema,
  ServiceDateSchema,
} from './query-schema';

function publicFlight(item: PublicFlightRecord) {
  return {
    id: item.id,
    flightNumber: item.flightNumber,
    serviceDate: item.serviceDate,
    direction: item.direction,
    scheduledAt: item.scheduledAt,
    estimatedAt: item.estimatedAt,
    actualAt: item.actualAt,
    originCode: item.originCode,
    destinationCode: item.destinationCode,
    gate: item.gate,
    operationalStatus: item.operationalStatus,
    performanceStatus: item.performanceStatus,
    delayMinutes: item.delayMinutes,
    updatedAt: item.updatedAt,
  };
}

export function createFlightQueryService(repository: FlightQueryRepository) {
  return {
    async getDailySummary(value: string) {
      const item = await repository.getDailySummary(
        ServiceDateSchema.parse(value),
      );
      if (!item) return null;
      return {
        ...item,
        cancellationRate: item.cancellationRate?.toNumber() ?? null,
        onTimeRate: item.onTimeRate?.toNumber() ?? null,
        averageDelayMinutes: item.averageDelayMinutes?.toNumber() ?? null,
        lastUpdatedAt: item.updatedAt,
      };
    },
    async listFlights(value: unknown) {
      const query = FlightListQuerySchema.parse(value);
      const result = await repository.listFlights(query);
      return {
        ...result,
        page: query.page,
        pageSize: query.pageSize,
        items: result.items.map(publicFlight),
      };
    },
    async getFlightDetails(value: unknown) {
      const item = await repository.getFlightDetails(
        FlightDetailsQuerySchema.parse(value),
      );
      return item ? publicFlight(item) : null;
    },
    async listHistory(value: unknown) {
      const query = FlightListQuerySchema.parse(value);
      const result = await repository.listHistory(query);
      return {
        ...result,
        page: query.page,
        pageSize: query.pageSize,
        items: result.items.map(publicFlight),
      };
    },
    async listCancellations(value: unknown) {
      const query = FlightListQuerySchema.omit({ flight: true }).parse(value);
      const result = await repository.listCancellations(query);
      return {
        ...result,
        page: query.page,
        pageSize: query.pageSize,
        items: result.items.map(publicFlight),
      };
    },
  };
}

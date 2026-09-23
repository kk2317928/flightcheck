import {
  createFlightObservationRepository,
  createFlightSyncRepository,
  createJobLockRepository,
  createPrismaClient,
  createStatisticsRepository,
} from '@flightcheck/db';
import {
  MacauAirportFlightSource,
  MacauAirportHttpClient,
  type FlightSourceAdapter,
} from '@flightcheck/flight-source';
import {
  createJobCorrelationId,
  createLogger,
  parseEnvironment,
  type StructuredLogger,
} from '@flightcheck/shared';

import { createFlightSyncService } from './flight-sync.js';
import { createStatisticsService } from './statistics-service.js';

export interface WorkerCompositionOptions {
  source?: FlightSourceAdapter;
  now?: () => Date;
  logger?: StructuredLogger;
  createOwnerId?: () => string;
}

export function createWorkerServices(
  environment: Record<string, string | undefined>,
  options: WorkerCompositionOptions = {},
) {
  const parsed = parseEnvironment(environment);
  const now = options.now ?? (() => new Date());
  const prisma = createPrismaClient(parsed.DATABASE_URL);
  const source =
    options.source ??
    new MacauAirportFlightSource(new MacauAirportHttpClient({ now }), now);
  const logger = options.logger ?? createLogger({ service: 'worker' });
  const flightSyncService = createFlightSyncService({
    lock: createJobLockRepository(prisma),
    source,
    syncRepository: createFlightSyncRepository(prisma),
    observationRepository: createFlightObservationRepository(prisma),
    now,
    createOwnerId:
      options.createOwnerId ?? (() => createJobCorrelationId('flight-sync')),
  });
  const statisticsService = createStatisticsService({
    repository: createStatisticsRepository(prisma),
    now,
  });

  return { prisma, flightSyncService, statisticsService, logger };
}

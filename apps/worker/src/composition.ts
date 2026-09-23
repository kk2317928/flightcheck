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
import type { WorkerHeartbeatStore } from './heartbeat.js';
import type { StartupRecoveryStore } from './recovery.js';

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

  const recoveryStore: StartupRecoveryStore = {
    async clearExpiredLocks(instant) {
      const result = await prisma.jobLock.deleteMany({
        where: { expiresAt: { lte: instant } },
      });
      return result.count;
    },
    async getDailyStatisticStatus(serviceDate) {
      const statistic = await prisma.dailyStatistic.findUnique({
        where: { serviceDate: new Date(`${serviceDate}T00:00:00.000Z`) },
        select: { settlementStatus: true },
      });
      return statistic?.settlementStatus ?? null;
    },
  };
  const heartbeatStore: WorkerHeartbeatStore = {
    async record(input) {
      await prisma.jobLock.upsert({
        where: { name: 'worker-heartbeat' },
        create: {
          name: 'worker-heartbeat',
          ownerId: input.ownerId,
          acquiredAt: input.observedAt,
          heartbeatAt: input.observedAt,
          expiresAt: input.expiresAt,
        },
        update: {
          ownerId: input.ownerId,
          heartbeatAt: input.observedAt,
          expiresAt: input.expiresAt,
        },
      });
    },
  };

  return {
    prisma,
    flightSyncService,
    statisticsService,
    recoveryStore,
    heartbeatStore,
    heartbeatOwnerId: createJobCorrelationId('worker-heartbeat'),
    logger,
  };
}

import {
  createJobCorrelationId,
  createLogger,
  parseEnvironment,
  type StructuredLogger,
} from '@flightcheck/shared';
import { createWorkerServices } from './composition.js';
import { getWorkerHealth } from './health.js';
import { startWorkerHeartbeat } from './heartbeat.js';
import { runStartupRecovery } from './recovery.js';
import { startFlightSyncScheduler } from './scheduler.js';
import type { FlightSyncService } from './flight-sync.js';
import {
  startStatisticsScheduler,
  type StatisticsScheduler,
} from './statistics-scheduler.js';
import type { StatisticsService } from './statistics-service.js';

export interface WorkerRuntime {
  stop(): void;
  disconnect(): Promise<void>;
  shutdown(): Promise<void>;
}
interface RuntimeOverrides {
  createServices?: (
    environment: Record<string, string | undefined>,
    options: { logger: StructuredLogger; now: () => Date },
  ) => {
    flightSyncService: FlightSyncService;
    statisticsService: StatisticsService;
    recoveryStore: Parameters<typeof runStartupRecovery>[0]['store'];
    heartbeatStore: Parameters<typeof startWorkerHeartbeat>[0]['store'];
    heartbeatOwnerId: string;
    prisma: { $disconnect(): Promise<void> };
  };
  startScheduler?: typeof startFlightSyncScheduler;
  startStatisticsScheduler?: typeof startStatisticsScheduler;
  runRecovery?: typeof runStartupRecovery;
  startHeartbeat?: typeof startWorkerHeartbeat;
  now?: () => Date;
}

export async function runWorkerStartup(
  sink?: (line: string) => void,
  environment: Record<string, string | undefined> = process.env,
  overrides: RuntimeOverrides = {},
): Promise<WorkerRuntime> {
  parseEnvironment(environment);
  const logger = createLogger({ service: 'worker', sink });
  const now = overrides.now ?? (() => new Date());
  const services = (overrides.createServices ?? createWorkerServices)(
    environment,
    { logger, now },
  );
  await (overrides.runRecovery ?? runStartupRecovery)({
    store: services.recoveryStore,
    flightSync: services.flightSyncService,
    statistics: services.statisticsService,
    now,
    logger,
  });
  const heartbeat = (overrides.startHeartbeat ?? startWorkerHeartbeat)({
    store: services.heartbeatStore,
    ownerId: services.heartbeatOwnerId,
    now,
    logger,
  });
  logger.info('worker.ready', {
    correlationId: createJobCorrelationId('worker-start'),
    health: getWorkerHealth(),
  });
  const scheduler = (overrides.startScheduler ?? startFlightSyncScheduler)({
    service: services.flightSyncService,
    now,
    logger,
    runOnStart: false,
  });
  const statisticsScheduler: StatisticsScheduler = (
    overrides.startStatisticsScheduler ?? startStatisticsScheduler
  )({
    service: services.statisticsService,
    now,
    logger,
  });
  let stopped = false;
  let shutdownPromise: Promise<void> | undefined;
  const stop = () => {
    if (!stopped) {
      stopped = true;
      scheduler.stop();
      statisticsScheduler.stop();
      heartbeat.stop();
    }
  };
  return {
    stop,
    disconnect: () => services.prisma.$disconnect(),
    shutdown() {
      stop();
      shutdownPromise ??= Promise.all([
        scheduler.waitForIdle(),
        statisticsScheduler.waitForIdle(),
        heartbeat.waitForIdle(),
      ]).then(() => services.prisma.$disconnect());
      return shutdownPromise;
    },
  };
}

export function installWorkerSignalHandlers(
  runtime: WorkerRuntime,
  processPort: Pick<NodeJS.Process, 'once'> = process,
): void {
  const shutdown = () => void runtime.shutdown();
  processPort.once('SIGINT', shutdown);
  processPort.once('SIGTERM', shutdown);
}

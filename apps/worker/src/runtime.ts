import {
  createJobCorrelationId,
  createLogger,
  parseEnvironment,
  type StructuredLogger,
} from '@flightcheck/shared';
import { createWorkerServices } from './composition.js';
import { getWorkerHealth } from './health.js';
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
    prisma: { $disconnect(): Promise<void> };
  };
  startScheduler?: typeof startFlightSyncScheduler;
  startStatisticsScheduler?: typeof startStatisticsScheduler;
  now?: () => Date;
}

export function runWorkerStartup(
  sink?: (line: string) => void,
  environment: Record<string, string | undefined> = process.env,
  overrides: RuntimeOverrides = {},
): WorkerRuntime {
  parseEnvironment(environment);
  const logger = createLogger({ service: 'worker', sink });
  const now = overrides.now ?? (() => new Date());
  const services = (overrides.createServices ?? createWorkerServices)(
    environment,
    { logger, now },
  );
  logger.info('worker.ready', {
    correlationId: createJobCorrelationId('worker-start'),
    health: getWorkerHealth(),
  });
  const scheduler = (overrides.startScheduler ?? startFlightSyncScheduler)({
    service: services.flightSyncService,
    now,
    logger,
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

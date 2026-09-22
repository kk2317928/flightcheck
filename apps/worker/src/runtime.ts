import {
  createJobCorrelationId,
  createLogger,
  parseEnvironment,
} from '@flightcheck/shared';

import { getWorkerHealth } from './health.js';

export function runWorkerStartup(
  sink?: (line: string) => void,
  environment: Record<string, string | undefined> = process.env,
): void {
  parseEnvironment(environment);
  const logger = createLogger({ service: 'worker', sink });

  logger.info('worker.ready', {
    correlationId: createJobCorrelationId('worker-start'),
    health: getWorkerHealth(),
  });
}

import { createJobCorrelationId, createLogger } from '@flightcheck/shared';

import { getWorkerHealth } from './health.js';

export function runWorkerStartup(sink?: (line: string) => void): void {
  const logger = createLogger({ service: 'worker', sink });

  logger.info('worker.ready', {
    correlationId: createJobCorrelationId('worker-start'),
    health: getWorkerHealth(),
  });
}

import { getWorkerHealth } from './health.js';

export function startWorker(): void {
  process.stdout.write(`${JSON.stringify(getWorkerHealth())}\n`);
}

startWorker();

import { pathToFileURL } from 'node:url';

import { getMacauDateKey, startOfMacauDateUtc } from '@flightcheck/shared';

import { createWorkerServices } from './composition.js';
import type { FlightSyncService } from './flight-sync.js';

export interface FlightSyncCliDependencies {
  service: FlightSyncService;
  now: () => Date;
  disconnect: () => Promise<void>;
  write: (line: string) => void;
}

function parseServiceDate(args: readonly string[], now: Date): string {
  if (args.length === 0) return getMacauDateKey(now);
  if (args.length !== 2 || args[0] !== '--date' || args[1] === undefined) {
    throw new TypeError('Usage: flight sync [--date YYYY-MM-DD]');
  }
  startOfMacauDateUtc(args[1]);
  return args[1];
}

export async function runFlightSyncCli(
  args: readonly string[],
  dependencies: FlightSyncCliDependencies,
): Promise<number> {
  try {
    const serviceDate = parseServiceDate(args, dependencies.now());
    const result = await dependencies.service.run({
      serviceDate,
      trigger: 'MANUAL',
    });
    dependencies.write(JSON.stringify(result));
    return result.status === 'FAILED' ? 1 : 0;
  } finally {
    await dependencies.disconnect();
  }
}

async function main(): Promise<void> {
  const services = createWorkerServices(process.env);
  process.exitCode = await runFlightSyncCli(process.argv.slice(2), {
    service: services.flightSyncService,
    now: () => new Date(),
    disconnect: () => services.prisma.$disconnect(),
    write: (line) => process.stdout.write(`${line}\n`),
  });
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

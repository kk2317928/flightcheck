import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { NormalizedFlight } from '@flightcheck/flight-source';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../src/client.js';
import { createFlightObservationRepository } from '../src/flight-observation-repository.js';
import {
  createFlightSyncRepository,
  FlightSyncPersistenceError,
} from '../src/flight-sync-repository.js';

const migrationsDirectory = fileURLToPath(
  new URL('../prisma/migrations/', import.meta.url),
);
const migrationPaths = readdirSync(migrationsDirectory, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((directory) => `${migrationsDirectory}/${directory}/migration.sql`);

const departure: NormalizedFlight = {
  flightNumber: 'NX001',
  serviceDate: '2026-09-22',
  direction: 'DEPARTURE',
  scheduledAt: new Date('2026-09-22T08:00:00.000Z'),
  estimatedAt: null,
  actualAt: null,
  origin: { code: 'MFM', name: 'Macau' },
  destination: { code: 'TPE', name: 'Taipei' },
  sourceStatus: 'SCHEDULED',
  rawStatus: 'Scheduled',
};

describe('FlightSyncRepository', () => {
  const databaseUrl = 'postgresql://postgres@127.0.0.1:55443/postgres';
  const db = new PGlite();
  const server = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: 55443,
    maxConnections: 10,
  });
  const prisma = createPrismaClient(databaseUrl);
  const repository = createFlightSyncRepository(prisma);
  const observations = createFlightObservationRepository(prisma);

  beforeAll(async () => {
    for (const migrationPath of migrationPaths) {
      await db.exec(readFileSync(migrationPath, 'utf8'));
    }
    await server.start();
  });

  beforeEach(async () => {
    await prisma.flightSnapshot.deleteMany();
    await prisma.flightStatusHistory.deleteMany();
    await prisma.flightInstance.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.scrapeRun.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await server.stop();
    await db.close();
  });

  it('starts a directional run in RUNNING state', async () => {
    const startedAt = new Date('2026-09-22T08:00:00.000Z');
    const started = await repository.startScrapeRun({
      source: 'DEPARTURES',
      correlationId: 'sync-departures',
      startedAt,
    });

    expect(started.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await expect(
      prisma.scrapeRun.findUniqueOrThrow({ where: { id: started.id } }),
    ).resolves.toMatchObject({
      source: 'DEPARTURES',
      status: 'RUNNING',
      correlationId: 'sync-departures',
      startedAt,
    });
  });

  it('completes a running run with all source-health fields', async () => {
    const { id } = await repository.startScrapeRun({
      source: 'ARRIVALS',
      correlationId: 'sync-arrivals',
      startedAt: new Date('2026-09-22T08:00:00.000Z'),
    });
    const warnings = [
      {
        code: 'SOURCE_PARTIAL' as const,
        message: 'One source section was unavailable',
        details: { section: 'codeshare' },
      },
    ];
    const finishedAt = new Date('2026-09-22T08:00:05.000Z');
    const fetchedAt = new Date('2026-09-22T08:00:04.000Z');
    const sourceUpdatedAt = new Date('2026-09-22T07:59:00.000Z');

    await repository.completeScrapeRun({
      id,
      status: 'PARTIAL',
      finishedAt,
      fetchedAt,
      sourceUpdatedAt,
      rowCount: 7,
      nxFlightCount: 4,
      warningCount: 1,
      warnings,
      errorCode: null,
    });

    await expect(
      prisma.scrapeRun.findUniqueOrThrow({ where: { id } }),
    ).resolves.toMatchObject({
      status: 'PARTIAL',
      finishedAt,
      fetchedAt,
      sourceUpdatedAt,
      rowCount: 7,
      nxFlightCount: 4,
      warningCount: 1,
      warnings,
      errorCode: null,
    });
  });

  it('rejects completion of a missing or already-finished run', async () => {
    const completion = {
      status: 'SUCCESS' as const,
      finishedAt: new Date('2026-09-22T08:00:05.000Z'),
      fetchedAt: new Date('2026-09-22T08:00:04.000Z'),
      sourceUpdatedAt: null,
      rowCount: 1,
      nxFlightCount: 1,
      warningCount: 0,
      warnings: [],
      errorCode: null,
    };

    await expect(
      repository.completeScrapeRun({
        ...completion,
        id: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toBeInstanceOf(FlightSyncPersistenceError);

    const run = await repository.startScrapeRun({
      source: 'DEPARTURES',
      correlationId: 'sync-once',
      startedAt: new Date('2026-09-22T08:00:00.000Z'),
    });
    await repository.completeScrapeRun({ ...completion, id: run.id });
    await expect(
      repository.completeScrapeRun({ ...completion, id: run.id }),
    ).rejects.toBeInstanceOf(FlightSyncPersistenceError);
  });

  it('loads exactly the current status-policy state', async () => {
    const run = await repository.startScrapeRun({
      source: 'DEPARTURES',
      correlationId: 'sync-status-state',
      startedAt: new Date('2026-09-22T08:00:00.000Z'),
    });
    const persisted = await observations.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:01:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const flightInstanceId = persisted.instances[0]?.flightInstanceId;
    expect(flightInstanceId).toBeDefined();
    await prisma.flightInstance.update({
      where: { id: flightInstanceId },
      data: {
        operationalStatus: 'CANCEL_PENDING',
        performanceStatus: 'DELAYED',
        delayMinutes: 25,
        scheduleVarianceMinutes: 25,
        cancelledObservedCount: 1,
        cancelConfirmedAt: new Date('2026-09-22T08:02:00.000Z'),
        lastStatusObservedAt: new Date('2026-09-22T08:03:00.000Z'),
      },
    });

    await expect(
      repository.getFlightStatusState(flightInstanceId ?? ''),
    ).resolves.toEqual({
      operationalStatus: 'CANCEL_PENDING',
      performanceStatus: 'DELAYED',
      delayMinutes: 25,
      scheduleVarianceMinutes: 25,
      cancelledObservedCount: 1,
      cancelConfirmedAt: new Date('2026-09-22T08:02:00.000Z'),
      lastStatusObservedAt: new Date('2026-09-22T08:03:00.000Z'),
    });
  });
});

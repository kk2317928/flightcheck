import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { NormalizedFlight } from '@flightcheck/flight-source';
import { PrismaPg } from '@prisma/adapter-pg';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../src/client.js';
import { createFlightObservationRepository } from '../src/flight-observation-repository.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

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

describe('FlightObservationRepository', () => {
  const databaseUrl = 'postgresql://postgres@127.0.0.1:55441/postgres';
  const db = new PGlite();
  const server = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: 55441,
    maxConnections: 10,
  });
  const prisma = createPrismaClient(databaseUrl);
  const repository = createFlightObservationRepository(prisma);

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

  async function createScrapeRun(correlationId: string) {
    return prisma.scrapeRun.create({
      data: {
        source: 'DEPARTURES',
        correlationId,
        startedAt: new Date('2026-09-22T08:00:00.000Z'),
      },
    });
  }

  it('persists a new observation with one flight instance and snapshot', async () => {
    const run = await createScrapeRun('run-first');

    await expect(
      repository.persistObservationBatch({
        scrapeRunId: run.id,
        observedAt: new Date('2026-09-22T08:05:00.000Z'),
        flights: [departure],
        warnings: [],
      }),
    ).resolves.toEqual({
      processedInstances: 1,
      insertedSnapshots: 1,
      unchangedSnapshots: 0,
      persistedWarnings: 0,
    });

    await expect(prisma.flight.count()).resolves.toBe(1);
    await expect(prisma.flightInstance.count()).resolves.toBe(1);
    await expect(prisma.flightSnapshot.count()).resolves.toBe(1);
  });

  it('replays an identical material payload without a second snapshot', async () => {
    const firstRun = await createScrapeRun('run-replay-first');
    const replayRun = await createScrapeRun('run-replay-second');
    await repository.persistObservationBatch({
      scrapeRunId: firstRun.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });

    await expect(
      repository.persistObservationBatch({
        scrapeRunId: replayRun.id,
        observedAt: new Date('2026-09-22T08:10:00.000Z'),
        flights: [{ ...departure }],
        warnings: [],
      }),
    ).resolves.toEqual({
      processedInstances: 1,
      insertedSnapshots: 0,
      unchangedSnapshots: 1,
      persistedWarnings: 0,
    });

    await expect(prisma.flightSnapshot.count()).resolves.toBe(1);
    await expect(
      prisma.flightInstance.findFirstOrThrow({
        select: { lastObservedAt: true },
      }),
    ).resolves.toEqual({
      lastObservedAt: new Date('2026-09-22T08:10:00.000Z'),
    });
  });

  it('creates one snapshot for a material change and none for its replay', async () => {
    const firstRun = await createScrapeRun('run-change-first');
    const changedRun = await createScrapeRun('run-change-second');
    const replayRun = await createScrapeRun('run-change-replay');
    await repository.persistObservationBatch({
      scrapeRunId: firstRun.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const delayed = {
      ...departure,
      estimatedAt: new Date('2026-09-22T08:20:00.000Z'),
    };

    await expect(
      repository.persistObservationBatch({
        scrapeRunId: changedRun.id,
        observedAt: new Date('2026-09-22T08:10:00.000Z'),
        flights: [delayed],
        warnings: [],
      }),
    ).resolves.toMatchObject({ insertedSnapshots: 1, unchangedSnapshots: 0 });
    await expect(
      repository.persistObservationBatch({
        scrapeRunId: replayRun.id,
        observedAt: new Date('2026-09-22T08:15:00.000Z'),
        flights: [delayed],
        warnings: [],
      }),
    ).resolves.toMatchObject({ insertedSnapshots: 0, unchangedSnapshots: 1 });
    await expect(prisma.flightSnapshot.count()).resolves.toBe(2);
  });

  it('keeps arrival and departure instances separate', async () => {
    const run = await createScrapeRun('run-directions');
    const arrival: NormalizedFlight = {
      ...departure,
      direction: 'ARRIVAL',
      origin: departure.destination,
      destination: departure.origin,
    };

    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure, arrival],
      warnings: [],
    });

    const instances = await prisma.flightInstance.findMany({
      orderBy: { direction: 'asc' },
      select: {
        direction: true,
        scheduledDepartureAt: true,
        scheduledArrivalAt: true,
      },
    });
    expect(instances).toEqual([
      {
        direction: 'DEPARTURE',
        scheduledDepartureAt: departure.scheduledAt,
        scheduledArrivalAt: null,
      },
      {
        direction: 'ARRIVAL',
        scheduledDepartureAt: null,
        scheduledArrivalAt: arrival.scheduledAt,
      },
    ]);
  });

  it('preserves status-engine fields when refreshing an observation', async () => {
    const firstRun = await createScrapeRun('run-status-first');
    const secondRun = await createScrapeRun('run-status-second');
    await repository.persistObservationBatch({
      scrapeRunId: firstRun.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const instance = await prisma.flightInstance.findFirstOrThrow();
    await prisma.flightInstance.update({
      where: { id: instance.id },
      data: {
        operationalStatus: 'CANCEL_PENDING',
        performanceStatus: 'DELAYED',
        delayMinutes: 20,
        cancelledObservedCount: 1,
      },
    });

    await repository.persistObservationBatch({
      scrapeRunId: secondRun.id,
      observedAt: new Date('2026-09-22T08:10:00.000Z'),
      flights: [{ ...departure, rawStatus: 'Delayed' }],
      warnings: [],
    });

    await expect(
      prisma.flightInstance.findUniqueOrThrow({ where: { id: instance.id } }),
    ).resolves.toMatchObject({
      operationalStatus: 'CANCEL_PENDING',
      performanceStatus: 'DELAYED',
      delayMinutes: 20,
      cancelledObservedCount: 1,
    });
  });

  it('replaces scrape warnings and keeps the count consistent', async () => {
    const run = await createScrapeRun('run-warnings');
    const warnings = [
      {
        code: 'UNKNOWN_STATUS' as const,
        message: 'Unknown source status',
        flightNumber: 'NX001',
      },
      {
        code: 'SOURCE_PARTIAL' as const,
        message: 'Arrivals unavailable',
        details: { direction: 'ARRIVAL' },
      },
    ];

    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [],
      warnings,
    });
    await expect(
      prisma.scrapeRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({ warnings, warningCount: 2 });

    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:10:00.000Z'),
      flights: [],
      warnings: [],
    });
    await expect(
      prisma.scrapeRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({ warnings: [], warningCount: 0 });
  });

  it('rolls back the whole batch when a later observation is invalid', async () => {
    const run = await createScrapeRun('run-rollback');
    const invalidFlight = { ...departure, flightNumber: '' };

    await expect(
      repository.persistObservationBatch({
        scrapeRunId: run.id,
        observedAt: new Date('2026-09-22T08:05:00.000Z'),
        flights: [departure, invalidFlight],
        warnings: [{ code: 'MALFORMED_ROW', message: 'Invalid flight number' }],
      }),
    ).rejects.toThrow();

    await expect(prisma.flight.count()).resolves.toBe(0);
    await expect(prisma.flightInstance.count()).resolves.toBe(0);
    await expect(prisma.flightSnapshot.count()).resolves.toBe(0);
    await expect(
      prisma.scrapeRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({ warnings: null, warningCount: 0 });
  });

  it('retains the database cause when persistence fails', async () => {
    try {
      await repository.persistObservationBatch({
        scrapeRunId: '00000000-0000-0000-0000-000000000099',
        observedAt: new Date('2026-09-22T08:05:00.000Z'),
        flights: [departure],
        warnings: [],
      });
      expect.unreachable('missing scrape run must reject');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) return;
      expect(error.message).toContain('persist observation batch');
      expect(error.cause).toBeInstanceOf(Error);
    }
  });

  it('does not record an unchanged status', async () => {
    const run = await createScrapeRun('run-status-unchanged');
    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const instance = await prisma.flightInstance.findFirstOrThrow();

    await expect(
      repository.recordStatusTransition({
        flightInstanceId: instance.id,
        expectedOperationalStatus: 'SCHEDULED',
        expectedPerformanceStatus: 'PENDING',
        expectedDelayMinutes: null,
        expectedScheduleVarianceMinutes: null,
        expectedCancelledObservedCount: 0,
        expectedCancelConfirmedAt: null,
        expectedLastStatusObservedAt: null,
        operationalStatus: 'SCHEDULED',
        performanceStatus: 'PENDING',
        delayMinutes: null,
        scheduleVarianceMinutes: null,
        cancelledObservedCount: 0,
        cancelConfirmedAt: null,
        lastStatusObservedAt: new Date('2026-09-22T08:06:00.000Z'),
        reason: 'No material status change',
        observedAt: new Date('2026-09-22T08:06:00.000Z'),
      }),
    ).resolves.toEqual({ changed: false });
    await expect(
      prisma.flightInstance.findUniqueOrThrow({ where: { id: instance.id } }),
    ).resolves.toMatchObject({
      lastStatusObservedAt: new Date('2026-09-22T08:06:00.000Z'),
    });
    await expect(prisma.flightStatusHistory.count()).resolves.toBe(0);
  });

  it('records one real status transition with previous and target values', async () => {
    const run = await createScrapeRun('run-status-changed');
    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const instance = await prisma.flightInstance.findFirstOrThrow();

    await expect(
      repository.recordStatusTransition({
        flightInstanceId: instance.id,
        expectedOperationalStatus: 'SCHEDULED',
        expectedPerformanceStatus: 'PENDING',
        expectedDelayMinutes: null,
        expectedScheduleVarianceMinutes: null,
        expectedCancelledObservedCount: 0,
        expectedCancelConfirmedAt: null,
        expectedLastStatusObservedAt: null,
        operationalStatus: 'CANCEL_PENDING',
        performanceStatus: 'DELAYED',
        delayMinutes: 20,
        scheduleVarianceMinutes: 20,
        cancelledObservedCount: 1,
        cancelConfirmedAt: null,
        lastStatusObservedAt: new Date('2026-09-22T08:06:00.000Z'),
        reason: 'First explicit cancellation observation',
        observedAt: new Date('2026-09-22T08:06:00.000Z'),
      }),
    ).resolves.toEqual({ changed: true });
    await expect(
      prisma.flightInstance.findUniqueOrThrow({ where: { id: instance.id } }),
    ).resolves.toMatchObject({
      operationalStatus: 'CANCEL_PENDING',
      performanceStatus: 'DELAYED',
      delayMinutes: 20,
      scheduleVarianceMinutes: 20,
      cancelledObservedCount: 1,
    });
    await expect(
      prisma.flightStatusHistory.findFirstOrThrow(),
    ).resolves.toMatchObject({
      previousOperationalStatus: 'SCHEDULED',
      previousPerformanceStatus: 'PENDING',
      previousDelayMinutes: null,
      previousScheduleVarianceMinutes: null,
      operationalStatus: 'CANCEL_PENDING',
      performanceStatus: 'DELAYED',
      delayMinutes: 20,
      scheduleVarianceMinutes: 20,
      reason: 'First explicit cancellation observation',
      observedAt: new Date('2026-09-22T08:06:00.000Z'),
    });
  });

  it('deduplicates concurrent identical transitions', async () => {
    const run = await createScrapeRun('run-status-concurrent');
    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const instance = await prisma.flightInstance.findFirstOrThrow();
    const transition = {
      flightInstanceId: instance.id,
      expectedOperationalStatus: 'SCHEDULED' as const,
      expectedPerformanceStatus: 'PENDING' as const,
      expectedDelayMinutes: null,
      expectedScheduleVarianceMinutes: null,
      expectedCancelledObservedCount: 0,
      expectedCancelConfirmedAt: null,
      expectedLastStatusObservedAt: null,
      operationalStatus: 'CANCEL_PENDING' as const,
      performanceStatus: 'DELAYED' as const,
      delayMinutes: 20,
      scheduleVarianceMinutes: 20,
      cancelledObservedCount: 1,
      cancelConfirmedAt: null,
      lastStatusObservedAt: new Date('2026-09-22T08:06:00.000Z'),
      reason: 'Concurrent first cancellation observation',
      observedAt: new Date('2026-09-22T08:06:00.000Z'),
    };

    const results = await Promise.all([
      repository.recordStatusTransition(transition),
      repository.recordStatusTransition(transition),
    ]);

    expect(results.map(({ changed }) => changed).sort()).toEqual([false, true]);
    await expect(prisma.flightStatusHistory.count()).resolves.toBe(1);
    await expect(
      prisma.flightInstance.findUniqueOrThrow({ where: { id: instance.id } }),
    ).resolves.toMatchObject({
      operationalStatus: 'CANCEL_PENDING',
      performanceStatus: 'DELAYED',
      delayMinutes: 20,
      scheduleVarianceMinutes: 20,
      cancelledObservedCount: 1,
    });
  });

  it('deduplicates concurrent identical snapshots', async () => {
    const firstRun = await createScrapeRun('run-snapshot-concurrent-first');
    const secondRun = await createScrapeRun('run-snapshot-concurrent-second');
    const observedAt = new Date('2026-09-22T08:05:00.000Z');

    const results = await Promise.all([
      repository.persistObservationBatch({
        scrapeRunId: firstRun.id,
        observedAt,
        flights: [departure],
        warnings: [],
      }),
      repository.persistObservationBatch({
        scrapeRunId: secondRun.id,
        observedAt,
        flights: [departure],
        warnings: [],
      }),
    ]);

    expect(
      results.reduce((sum, result) => sum + result.insertedSnapshots, 0),
    ).toBe(1);
    expect(
      results.reduce((sum, result) => sum + result.unchangedSnapshots, 0),
    ).toBe(1);
    await expect(prisma.flightSnapshot.count()).resolves.toBe(1);
  });

  it('uses a conflict-safe insert when discovering a new flight', async () => {
    const queries: string[] = [];
    const loggingPrisma = new PrismaClient({
      adapter: new PrismaPg(databaseUrl),
      log: [{ emit: 'event', level: 'query' }],
    });
    loggingPrisma.$on('query', ({ query }) => queries.push(query));
    const loggingRepository = createFlightObservationRepository(loggingPrisma);
    const run = await createScrapeRun('run-flight-insert-sql');

    try {
      await loggingRepository.persistObservationBatch({
        scrapeRunId: run.id,
        observedAt: new Date('2026-09-22T08:05:00.000Z'),
        flights: [departure],
        warnings: [],
      });
    } finally {
      await loggingPrisma.$disconnect();
    }

    const flightInsert = queries.find((query) =>
      query.includes('INSERT INTO "public"."Flight"'),
    );
    expect(flightInsert).toMatch(/ON CONFLICT DO NOTHING/i);
  });

  it('rejects a stale status transition instead of overwriting newer state', async () => {
    const run = await createScrapeRun('run-status-stale');
    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const instance = await prisma.flightInstance.findFirstOrThrow();
    await prisma.flightInstance.update({
      where: { id: instance.id },
      data: { operationalStatus: 'CANCELLED' },
    });

    await expect(
      repository.recordStatusTransition({
        flightInstanceId: instance.id,
        expectedOperationalStatus: 'SCHEDULED',
        expectedPerformanceStatus: 'PENDING',
        expectedDelayMinutes: null,
        expectedScheduleVarianceMinutes: null,
        expectedCancelledObservedCount: 0,
        expectedCancelConfirmedAt: null,
        expectedLastStatusObservedAt: null,
        operationalStatus: 'CANCEL_PENDING',
        performanceStatus: 'PENDING',
        delayMinutes: null,
        scheduleVarianceMinutes: null,
        cancelledObservedCount: 1,
        cancelConfirmedAt: null,
        lastStatusObservedAt: new Date('2026-09-22T08:06:00.000Z'),
        reason: 'Stale first cancellation observation',
        observedAt: new Date('2026-09-22T08:06:00.000Z'),
      }),
    ).rejects.toThrow(/stale status transition/i);
    await expect(
      prisma.flightInstance.findUniqueOrThrow({ where: { id: instance.id } }),
    ).resolves.toMatchObject({ operationalStatus: 'CANCELLED' });
    await expect(prisma.flightStatusHistory.count()).resolves.toBe(0);
  });

  it('rejects a stale transition when only cancellation count changed', async () => {
    const run = await createScrapeRun('run-status-stale-count');
    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const instance = await prisma.flightInstance.findFirstOrThrow();
    await prisma.flightInstance.update({
      where: { id: instance.id },
      data: { cancelledObservedCount: 1 },
    });

    await expect(
      repository.recordStatusTransition({
        flightInstanceId: instance.id,
        expectedOperationalStatus: 'SCHEDULED',
        expectedPerformanceStatus: 'PENDING',
        expectedDelayMinutes: null,
        expectedScheduleVarianceMinutes: null,
        expectedCancelledObservedCount: 0,
        expectedCancelConfirmedAt: null,
        expectedLastStatusObservedAt: null,
        operationalStatus: 'CANCEL_PENDING',
        performanceStatus: 'PENDING',
        delayMinutes: null,
        scheduleVarianceMinutes: null,
        cancelledObservedCount: 1,
        cancelConfirmedAt: null,
        lastStatusObservedAt: new Date('2026-09-22T08:06:00.000Z'),
        reason: 'Stale cancellation count',
        observedAt: new Date('2026-09-22T08:06:00.000Z'),
      }),
    ).rejects.toThrow(/stale status transition/i);
    await expect(prisma.flightStatusHistory.count()).resolves.toBe(0);
  });

  it('rejects a stale transition when only confirmation time changed', async () => {
    const run = await createScrapeRun('run-status-stale-confirmed-at');
    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const instance = await prisma.flightInstance.findFirstOrThrow();
    const winnerConfirmedAt = new Date('2026-09-22T08:05:30.000Z');
    await prisma.flightInstance.update({
      where: { id: instance.id },
      data: { cancelConfirmedAt: winnerConfirmedAt },
    });

    await expect(
      repository.recordStatusTransition({
        flightInstanceId: instance.id,
        expectedOperationalStatus: 'SCHEDULED',
        expectedPerformanceStatus: 'PENDING',
        expectedDelayMinutes: null,
        expectedScheduleVarianceMinutes: null,
        expectedCancelledObservedCount: 0,
        expectedCancelConfirmedAt: null,
        expectedLastStatusObservedAt: null,
        operationalStatus: 'CANCEL_PENDING',
        performanceStatus: 'PENDING',
        delayMinutes: null,
        scheduleVarianceMinutes: null,
        cancelledObservedCount: 1,
        cancelConfirmedAt: null,
        lastStatusObservedAt: new Date('2026-09-22T08:06:00.000Z'),
        reason: 'Stale confirmation time',
        observedAt: new Date('2026-09-22T08:06:00.000Z'),
      }),
    ).rejects.toThrow(/stale status transition/i);
    await expect(prisma.flightStatusHistory.count()).resolves.toBe(0);
  });

  it('rejects a stale transition when only the status observation watermark changed', async () => {
    const run = await createScrapeRun('run-status-stale-watermark');
    await repository.persistObservationBatch({
      scrapeRunId: run.id,
      observedAt: new Date('2026-09-22T08:05:00.000Z'),
      flights: [departure],
      warnings: [],
    });
    const instance = await prisma.flightInstance.findFirstOrThrow();
    await prisma.flightInstance.update({
      where: { id: instance.id },
      data: {
        lastStatusObservedAt: new Date('2026-09-22T08:05:30.000Z'),
      },
    });

    await expect(
      repository.recordStatusTransition({
        flightInstanceId: instance.id,
        expectedOperationalStatus: 'SCHEDULED',
        expectedPerformanceStatus: 'PENDING',
        expectedDelayMinutes: null,
        expectedScheduleVarianceMinutes: null,
        expectedCancelledObservedCount: 0,
        expectedCancelConfirmedAt: null,
        expectedLastStatusObservedAt: null,
        operationalStatus: 'CANCEL_PENDING',
        performanceStatus: 'PENDING',
        delayMinutes: null,
        scheduleVarianceMinutes: null,
        cancelledObservedCount: 1,
        cancelConfirmedAt: null,
        lastStatusObservedAt: new Date('2026-09-22T08:06:00.000Z'),
        reason: 'Stale observation watermark',
        observedAt: new Date('2026-09-22T08:06:00.000Z'),
      }),
    ).rejects.toThrow(/stale status transition/i);
    await expect(prisma.flightStatusHistory.count()).resolves.toBe(0);
  });
});

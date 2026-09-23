import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../src/client.js';
import { createStatisticsRepository } from '../src/statistics-repository.js';

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

const preliminary = {
  serviceDate: '2026-09-22',
  totalFlights: 2,
  departureFlights: 1,
  arrivalFlights: 1,
  determinedFlights: 1,
  pendingFlights: 1,
  onTimeFlights: 1,
  delayedFlights: 0,
  severeDelayedFlights: 0,
  cancelledFlights: 0,
  unknownFlights: 0,
  cancellationRate: 0,
  onTimeRate: 1,
  averageDelayMinutes: 0,
  dataQuality: 'COMPLETE' as const,
  settlementStatus: 'PRELIMINARY' as const,
  cutoffAt: new Date('2026-09-22T15:30:00.000Z'),
  settledAt: null,
  warningSummary: { reasons: [] },
  trigger: 'SCHEDULED' as const,
};

describe('StatisticsRepository', () => {
  const databaseUrl = 'postgresql://postgres@127.0.0.1:55447/postgres';
  const db = new PGlite();
  const server = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: 55447,
    maxConnections: 10,
  });
  const prisma = createPrismaClient(databaseUrl);
  const repository = createStatisticsRepository(prisma);

  beforeAll(async () => {
    for (const migrationPath of migrationPaths) {
      await db.exec(readFileSync(migrationPath, 'utf8'));
    }
    await server.start();
  });

  beforeEach(async () => {
    await prisma.dailyStatistic.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await server.stop();
    await db.close();
  });

  it('upserts the same service date without duplicating rows', async () => {
    await repository.saveDailyStatistic(preliminary);
    const saved = await repository.saveDailyStatistic({
      ...preliminary,
      totalFlights: 3,
      pendingFlights: 2,
    });

    expect(
      await prisma.dailyStatistic.count({
        where: { serviceDate: new Date('2026-09-22T00:00:00.000Z') },
      }),
    ).toBe(1);
    expect(saved).toMatchObject({ totalFlights: 3 });
  });

  it('does not downgrade FINAL through an ordinary scheduled recalculation', async () => {
    await repository.saveDailyStatistic({
      ...preliminary,
      settlementStatus: 'FINAL',
      settledAt: new Date('2026-09-22T16:05:00.000Z'),
    });

    const saved = await repository.saveDailyStatistic(preliminary);

    expect(saved.settlementStatus).toBe('FINAL');
    expect(saved.settledAt).toEqual(new Date('2026-09-22T16:05:00.000Z'));
  });

  it('allows an explicit manual FINAL recalculation to replace FINAL values', async () => {
    await repository.saveDailyStatistic({
      ...preliminary,
      settlementStatus: 'FINAL',
      settledAt: new Date('2026-09-22T16:05:00.000Z'),
    });

    const saved = await repository.saveDailyStatistic({
      ...preliminary,
      totalFlights: 4,
      pendingFlights: 3,
      settlementStatus: 'FINAL',
      settledAt: new Date('2026-09-22T17:00:00.000Z'),
      trigger: 'MANUAL',
    });

    expect(saved).toMatchObject({
      totalFlights: 4,
      settlementStatus: 'FINAL',
      settledAt: new Date('2026-09-22T17:00:00.000Z'),
    });
  });
});

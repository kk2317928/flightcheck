import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/client.js';
import { createFlightQueryRepository } from '../src/flight-query-repository.js';

const directory = fileURLToPath(
  new URL('../prisma/migrations/', import.meta.url),
);
const migrations = readdirSync(directory, { withFileTypes: true })
  .filter((x) => x.isDirectory())
  .map((x) => x.name)
  .sort()
  .map((x) => `${directory}/${x}/migration.sql`);

describe('FlightQueryRepository', () => {
  const db = new PGlite();
  const server = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: 55448,
    maxConnections: 10,
  });
  const prisma = createPrismaClient(
    'postgresql://postgres@127.0.0.1:55448/postgres',
  );
  const repository = createFlightQueryRepository(prisma);
  beforeAll(async () => {
    for (const path of migrations) await db.exec(readFileSync(path, 'utf8'));
    await server.start();
    const flight = await prisma.flight.create({
      data: { flightNumber: 'NX862D' },
    });
    for (const [day, hour, status] of [
      ['2026-09-22', '08', 'SCHEDULED'],
      ['2026-09-22', '09', 'CANCELLED'],
      ['2026-09-23', '08', 'ARRIVED'],
    ] as const)
      await prisma.flightInstance.create({
        data: {
          flightId: flight.id,
          serviceDate: new Date(`${day}T00:00:00Z`),
          direction: 'DEPARTURE',
          scheduledAt: new Date(`${day}T${hour}:00:00Z`),
          operationalStatus: status,
        },
      });
  }, 20_000);
  afterAll(async () => {
    await prisma.$disconnect();
    await server.stop();
    await db.close();
  });

  it('isolates the exact service date and same-number flight', async () => {
    const result = await repository.listFlights({
      date: '2026-09-22',
      flight: 'NX862D',
      page: 1,
      pageSize: 20,
    });
    expect(result.total).toBe(2);
    expect(result.items.map((x) => x.scheduledAt.toISOString())).toEqual([
      '2026-09-22T08:00:00.000Z',
      '2026-09-22T09:00:00.000Z',
    ]);
  });

  it('filters cancellations before pagination', async () => {
    const result = await repository.listCancellations({
      date: '2026-09-22',
      page: 1,
      pageSize: 1,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.operationalStatus).toBe('CANCELLED');
  });
});

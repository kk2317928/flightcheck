/* eslint-disable @typescript-eslint/require-await */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import {
  MacauAirportFlightSource,
  type MacauAirportBoardClient,
  type MacauAirportBoardResult,
} from '@flightcheck/flight-source';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createWorkerServices } from './composition.js';

const migrationsDirectory = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations/', import.meta.url),
);
const migrationPaths = readdirSync(migrationsDirectory, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((directory) => `${migrationsDirectory}/${directory}/migration.sql`);

function board(direction: 'DEPARTURE' | 'ARRIVAL') {
  const marker = direction === 'DEPARTURE' ? '1' : '';
  const heading = direction === 'DEPARTURE' ? 'Destination' : 'Origin';
  const gate = direction === 'DEPARTURE' ? '<td>8</td>' : '';
  return `<table id="flights-datatable"><thead><tr><td>Time</td><td>Airline</td><td>${heading}</td><td>Flight N°</td><td>Status</td></tr></thead><tbody><tr class="detail" data-flight-date="2026-09-22" data-is-departure="${marker}"><td>16:00</td><td>Air Macau</td><td>Tokyo-Narita</td><td>NX001</td>${gate}<td>Cancelled</td></tr></tbody></table>`;
}

describe('flight sync fixture integration', () => {
  const databaseUrl = 'postgresql://postgres@127.0.0.1:55444/postgres';
  const db = new PGlite();
  const server = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: 55444,
    maxConnections: 10,
  });
  let fetchedAt = new Date('2026-09-22T08:05:00.000Z');
  let failArrival = false;
  const client: MacauAirportBoardClient = {
    async fetchBoards(directions): Promise<MacauAirportBoardResult> {
      const direction = directions[0]!;
      if (direction === 'ARRIVAL' && failArrival) {
        return {
          status: 'FAILED',
          documents: [],
          errors: [
            {
              direction,
              attempts: 1,
              code: 'TIMEOUT',
              message: 'fixture timeout',
              retryable: true,
            },
          ],
        };
      }
      return {
        status: 'COMPLETE',
        documents: [
          {
            direction,
            html: board(direction),
            fetchedAt,
            sourceUpdatedAt: fetchedAt,
          },
        ],
        errors: [],
      };
    },
  };
  const source = new MacauAirportFlightSource(client, () => fetchedAt);
  let ownerSequence = 0;
  const services = createWorkerServices(
    { TZ: 'Asia/Macau', DATABASE_URL: databaseUrl },
    {
      source,
      now: () => fetchedAt,
      createOwnerId: () => `fixture-owner-${++ownerSequence}`,
    },
  );

  beforeAll(async () => {
    for (const migrationPath of migrationPaths) {
      await db.exec(readFileSync(migrationPath, 'utf8'));
    }
    await server.start();
  });

  beforeEach(async () => {
    await services.prisma.jobLock.deleteMany();
    await services.prisma.flightSnapshot.deleteMany();
    await services.prisma.flightStatusHistory.deleteMany();
    await services.prisma.flightInstance.deleteMany();
    await services.prisma.flight.deleteMany();
    await services.prisma.scrapeRun.deleteMany();
    fetchedAt = new Date('2026-09-22T08:05:00.000Z');
    failArrival = false;
  });

  afterAll(async () => {
    await services.prisma.$disconnect();
    await server.stop();
    await db.close();
  });

  it('advances cancellation, preserves direction identity, and isolates partial failure', async () => {
    await expect(
      services.flightSyncService.run({
        serviceDate: '2026-09-22',
        trigger: 'MANUAL',
      }),
    ).resolves.toMatchObject({ status: 'SUCCESS' });
    await expect(services.prisma.scrapeRun.count()).resolves.toBe(2);
    const pending = await services.prisma.flightInstance.findMany({
      orderBy: { direction: 'asc' },
    });
    expect(pending).toHaveLength(2);
    expect(new Set(pending.map(({ id }) => id)).size).toBe(2);
    expect(pending.map(({ operationalStatus }) => operationalStatus)).toEqual([
      'CANCEL_PENDING',
      'CANCEL_PENDING',
    ]);

    fetchedAt = new Date('2026-09-22T08:10:00.000Z');
    await services.flightSyncService.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });
    const confirmed = await services.prisma.flightInstance.findMany();
    expect(confirmed.map(({ operationalStatus }) => operationalStatus)).toEqual(
      ['CANCELLED', 'CANCELLED'],
    );
    expect(
      confirmed.map(({ cancelledObservedCount }) => cancelledObservedCount),
    ).toEqual([2, 2]);
    await expect(services.prisma.flightSnapshot.count()).resolves.toBe(2);

    await services.flightSyncService.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });
    await expect(services.prisma.flightSnapshot.count()).resolves.toBe(2);
    expect(
      (await services.prisma.flightInstance.findMany()).map(
        ({ cancelledObservedCount }) => cancelledObservedCount,
      ),
    ).toEqual([2, 2]);

    failArrival = true;
    const partial = await services.flightSyncService.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });
    expect(partial.status).toBe('PARTIAL');
    expect(partial.directions).toEqual([
      expect.objectContaining({ direction: 'DEPARTURE', status: 'SUCCESS' }),
      expect.objectContaining({
        direction: 'ARRIVAL',
        status: 'FAILED',
        errorCode: 'TIMEOUT',
      }),
    ]);
    await expect(services.prisma.flightInstance.count()).resolves.toBe(2);
    await expect(services.prisma.scrapeRun.count()).resolves.toBe(8);
  });
});

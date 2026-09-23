import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PrismaPg } from '@prisma/adapter-pg';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../src/client.js';
import {
  createJobLockRepository,
  JobLockPersistenceError,
} from '../src/job-lock-repository.js';
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

describe('JobLockRepository', () => {
  const databaseUrl = 'postgresql://postgres@127.0.0.1:55442/postgres';
  const db = new PGlite();
  const server = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: 55442,
    maxConnections: 10,
  });
  const prisma = createPrismaClient(databaseUrl);
  const repository = createJobLockRepository(prisma);
  const firstNow = new Date('2026-09-22T08:00:00.000Z');

  beforeAll(async () => {
    for (const migrationPath of migrationPaths) {
      await db.exec(readFileSync(migrationPath, 'utf8'));
    }
    await server.start();
  });

  beforeEach(async () => {
    await prisma.jobLock.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await server.stop();
    await db.close();
  });

  it('lets the first owner acquire while a second owner loses a live lease', async () => {
    await expect(
      repository.acquire({
        name: 'flight-sync',
        ownerId: 'worker-a',
        now: firstNow,
        leaseMs: 60_000,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.acquire({
        name: 'flight-sync',
        ownerId: 'worker-b',
        now: new Date('2026-09-22T08:00:30.000Z'),
        leaseMs: 60_000,
      }),
    ).resolves.toBe(false);

    await expect(
      prisma.jobLock.findUniqueOrThrow({ where: { name: 'flight-sync' } }),
    ).resolves.toMatchObject({
      ownerId: 'worker-a',
      acquiredAt: firstNow,
      heartbeatAt: firstNow,
      expiresAt: new Date('2026-09-22T08:01:00.000Z'),
    });
  });

  it('allows expiry takeover without giving the old owner mutation rights', async () => {
    await repository.acquire({
      name: 'flight-sync',
      ownerId: 'worker-a',
      now: firstNow,
      leaseMs: 60_000,
    });
    const takeoverAt = new Date('2026-09-22T08:01:00.000Z');

    await expect(
      repository.acquire({
        name: 'flight-sync',
        ownerId: 'worker-b',
        now: takeoverAt,
        leaseMs: 120_000,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.renew({
        name: 'flight-sync',
        ownerId: 'worker-a',
        now: new Date('2026-09-22T08:01:30.000Z'),
        leaseMs: 60_000,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.release({ name: 'flight-sync', ownerId: 'worker-a' }),
    ).resolves.toBe(false);

    await expect(
      prisma.jobLock.findUniqueOrThrow({ where: { name: 'flight-sync' } }),
    ).resolves.toMatchObject({ ownerId: 'worker-b', acquiredAt: takeoverAt });
  });

  it('lets the current owner renew and release its lease', async () => {
    await repository.acquire({
      name: 'flight-sync',
      ownerId: 'worker-a',
      now: firstNow,
      leaseMs: 60_000,
    });
    const renewedAt = new Date('2026-09-22T08:00:30.000Z');

    await expect(
      repository.renew({
        name: 'flight-sync',
        ownerId: 'worker-a',
        now: renewedAt,
        leaseMs: 120_000,
      }),
    ).resolves.toBe(true);
    await expect(
      prisma.jobLock.findUniqueOrThrow({ where: { name: 'flight-sync' } }),
    ).resolves.toMatchObject({
      ownerId: 'worker-a',
      heartbeatAt: renewedAt,
      expiresAt: new Date('2026-09-22T08:02:30.000Z'),
    });
    await expect(
      repository.release({ name: 'flight-sync', ownerId: 'worker-a' }),
    ).resolves.toBe(true);
    await expect(prisma.jobLock.count()).resolves.toBe(0);
  });

  it.each([
    {
      label: 'invalid date',
      input: {
        name: 'flight-sync',
        ownerId: 'worker-a',
        now: new Date(Number.NaN),
        leaseMs: 60_000,
      },
    },
    {
      label: 'zero lease',
      input: {
        name: 'flight-sync',
        ownerId: 'worker-a',
        now: firstNow,
        leaseMs: 0,
      },
    },
    {
      label: 'negative lease',
      input: {
        name: 'flight-sync',
        ownerId: 'worker-a',
        now: firstNow,
        leaseMs: -1,
      },
    },
  ])('rejects $label before issuing SQL', async ({ input }) => {
    await expect(repository.acquire(input)).rejects.toBeInstanceOf(
      JobLockPersistenceError,
    );
    await expect(repository.renew(input)).rejects.toBeInstanceOf(
      JobLockPersistenceError,
    );
    await expect(prisma.jobLock.count()).resolves.toBe(0);
  });

  it('uses conflict-safe acquisition and owner-qualified mutations', async () => {
    const queries: string[] = [];
    const loggingPrisma = new PrismaClient({
      adapter: new PrismaPg(databaseUrl),
      log: [{ emit: 'event', level: 'query' }],
    });
    loggingPrisma.$on('query', ({ query }) => queries.push(query));
    const loggingRepository = createJobLockRepository(loggingPrisma);

    try {
      await loggingRepository.acquire({
        name: 'flight-sync',
        ownerId: 'worker-a',
        now: firstNow,
        leaseMs: 60_000,
      });
      await loggingRepository.renew({
        name: 'flight-sync',
        ownerId: 'worker-a',
        now: new Date('2026-09-22T08:00:10.000Z'),
        leaseMs: 60_000,
      });
      await loggingRepository.release({
        name: 'flight-sync',
        ownerId: 'worker-a',
      });
    } finally {
      await loggingPrisma.$disconnect();
    }

    expect(queries.some((query) => /ON CONFLICT/i.test(query))).toBe(true);
    const ownerMutations = queries.filter((query) =>
      /(?:UPDATE|DELETE FROM).*JobLock/i.test(query),
    );
    expect(ownerMutations).toHaveLength(2);
    expect(ownerMutations.every((query) => /ownerId/i.test(query))).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../src/client.js';
import { seedDatabase } from '../src/seed.js';

const migrationPath = fileURLToPath(
  new URL(
    '../prisma/migrations/20260922000100_initial/migration.sql',
    import.meta.url,
  ),
);

describe('database seed', () => {
  const db = new PGlite();
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 55439 });

  beforeAll(async () => {
    await db.exec(readFileSync(migrationPath, 'utf8'));
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await db.close();
  });

  it('seeds an empty database idempotently through Prisma Client', async () => {
    const prisma = createPrismaClient(
      'postgresql://postgres@127.0.0.1:55439/postgres',
    );

    try {
      await seedDatabase(prisma);
      await prisma.socialTemplate.update({
        where: {
          type_name_version: { type: 'CANCELLED', name: 'default', version: 1 },
        },
        data: { content: 'Admin customized content' },
      });
      await prisma.setting.update({
        where: { key: 'flight.delayThresholdMinutes' },
        data: { value: 20 },
      });
      await seedDatabase(prisma);

      await expect(prisma.socialTemplate.count()).resolves.toBe(2);
      await expect(prisma.setting.count()).resolves.toBe(4);
      await expect(
        prisma.socialTemplate.findUniqueOrThrow({
          where: {
            type_name_version: {
              type: 'CANCELLED',
              name: 'default',
              version: 1,
            },
          },
        }),
      ).resolves.toMatchObject({ content: 'Admin customized content' });
      await expect(
        prisma.setting.findUniqueOrThrow({
          where: { key: 'flight.delayThresholdMinutes' },
        }),
      ).resolves.toMatchObject({ value: 20 });
    } finally {
      await prisma.$disconnect();
    }
  });
});

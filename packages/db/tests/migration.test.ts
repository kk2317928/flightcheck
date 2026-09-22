import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe('initial PostgreSQL migration', () => {
  const db = new PGlite();

  beforeAll(async () => {
    for (const migrationPath of migrationPaths) {
      await db.exec(readFileSync(migrationPath, 'utf8'));
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates all P0 tables on an empty database', async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );

    expect(result.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        'FlightInstance',
        'FlightSnapshot',
        'JobLock',
        'SocialEvent',
        'SocialPost',
      ]),
    );
  });

  it('adds previous values to status history', async () => {
    const result = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'FlightStatusHistory'`,
    );

    expect(result.rows.map(({ column_name }) => column_name)).toEqual(
      expect.arrayContaining([
        'previousOperationalStatus',
        'previousPerformanceStatus',
        'previousDelayMinutes',
        'previousScheduleVarianceMinutes',
        'scheduleVarianceMinutes',
      ]),
    );
  });

  it('adds signed schedule variance to flight instances', async () => {
    const result = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'FlightInstance'`,
    );

    expect(result.rows.map(({ column_name }) => column_name)).toContain(
      'scheduleVarianceMinutes',
    );
  });

  it('rejects duplicate social event idempotency keys', async () => {
    await db.exec(`
      INSERT INTO "SocialEvent"
        (id, type, status, "idempotencyKey", payload, "renderedContent", "scheduledPublishAt", "createdAt", "updatedAt")
      VALUES
        ('00000000-0000-0000-0000-000000000001', 'CANCELLED', 'PENDING', 'CANCELLED:flight-1', '{}', 'cancelled', NOW(), NOW(), NOW());
    `);

    await expect(
      db.exec(`
        INSERT INTO "SocialEvent"
          (id, type, status, "idempotencyKey", payload, "renderedContent", "scheduledPublishAt", "createdAt", "updatedAt")
        VALUES
          ('00000000-0000-0000-0000-000000000002', 'CANCELLED', 'PENDING', 'CANCELLED:flight-1', '{}', 'duplicate', NOW(), NOW(), NOW());
      `),
    ).rejects.toThrow(/SocialEvent_idempotencyKey_key|duplicate key/i);
  });

  it('rejects a second post for the same event and platform', async () => {
    await db.exec(`
      INSERT INTO "SocialPost"
        (id, "socialEventId", platform, status, "createdAt", "updatedAt")
      VALUES
        ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'THREADS', 'PENDING', NOW(), NOW());
    `);

    await expect(
      db.exec(`
        INSERT INTO "SocialPost"
          (id, "socialEventId", platform, status, "createdAt", "updatedAt")
        VALUES
          ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'THREADS', 'PENDING', NOW(), NOW());
      `),
    ).rejects.toThrow(/social_post_event_platform_key|duplicate key/i);
  });
});

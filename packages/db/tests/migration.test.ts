import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../prisma/migrations/20260922000100_initial/migration.sql',
    import.meta.url,
  ),
);

describe('initial PostgreSQL migration', () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(readFileSync(migrationPath, 'utf8'));
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

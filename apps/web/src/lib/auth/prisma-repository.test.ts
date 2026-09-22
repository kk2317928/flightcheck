import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createPrismaClient } from '@flightcheck/db';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from './password';
import { createPrismaAuthRepository } from './prisma-repository';
import { createAuthService } from './service';

const migrationPath = fileURLToPath(
  new URL(
    '../../../../../packages/db/prisma/migrations/20260922000100_initial/migration.sql',
    import.meta.url,
  ),
);

describe('Prisma Admin authentication', () => {
  const db = new PGlite();
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 55440 });
  const prisma = createPrismaClient(
    'postgresql://postgres@127.0.0.1:55440/postgres',
  );

  beforeAll(async () => {
    await db.exec(readFileSync(migrationPath, 'utf8'));
    await server.start();
    await prisma.adminUser.create({
      data: {
        id: '00000000-0000-0000-0000-000000000004',
        email: 'admin@example.com',
        passwordHash: await hashPassword('correct-password'),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await server.stop();
    await db.close();
  });

  it('persists login, validates the session, audits and revokes logout', async () => {
    const auth = createAuthService(createPrismaAuthRepository(prisma), {
      now: () => new Date('2026-09-22T10:00:00.000Z'),
    });

    const login = await auth.login({
      email: 'admin@example.com',
      password: 'correct-password',
      ipAddress: '203.0.113.8',
    });
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    await expect(auth.authenticate(login.rawToken)).resolves.toMatchObject({
      admin: { id: '00000000-0000-0000-0000-000000000004' },
    });
    await auth.logout(login.rawToken, '203.0.113.8');
    await expect(auth.authenticate(login.rawToken)).resolves.toBeNull();
    const actions = (
      await prisma.adminAuditLog.findMany({ select: { action: true } })
    ).map(({ action }) => action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'AUTH_LOGIN_ATTEMPT_RESERVED',
        'AUTH_LOGIN_SUCCEEDED',
        'AUTH_LOGOUT',
      ]),
    );
  });

  it('atomically caps concurrent attempts by account and source', async () => {
    const repository = createPrismaAuthRepository(prisma);
    const attemptedAt = new Date('2026-09-22T11:00:00.000Z');
    const reservations: boolean[] = [];
    for (let index = 0; index < 6; index += 1) {
      reservations.push(
        await repository.reserveLoginAttempt({
          email: index % 2 ? 'admin@example.com' : `other-${index}@example.com`,
          ipAddress: '198.51.100.9',
          since: new Date('2026-09-22T10:45:00.000Z'),
          attemptedAt,
          maxAttempts: 5,
        }),
      );
    }

    expect(reservations).toEqual([true, true, true, true, true, false]);
  });

  it('rejects expired sessions and sessions belonging to inactive admins', async () => {
    const repository = createPrismaAuthRepository(prisma);
    await prisma.adminSession.createMany({
      data: [
        {
          adminId: '00000000-0000-0000-0000-000000000004',
          tokenHash: 'expired-token',
          expiresAt: new Date('2026-09-22T09:00:00.000Z'),
        },
        {
          adminId: '00000000-0000-0000-0000-000000000004',
          tokenHash: 'inactive-token',
          expiresAt: new Date('2026-09-22T12:00:00.000Z'),
        },
      ],
    });

    await expect(
      repository.findActiveSession({
        tokenHash: 'expired-token',
        now: new Date('2026-09-22T10:00:00.000Z'),
      }),
    ).resolves.toBeNull();
    await prisma.adminUser.update({
      where: { id: '00000000-0000-0000-0000-000000000004' },
      data: { isActive: false },
    });
    await expect(
      repository.findActiveSession({
        tokenHash: 'inactive-token',
        now: new Date('2026-09-22T10:00:00.000Z'),
      }),
    ).resolves.toBeNull();
    await prisma.adminUser.update({
      where: { id: '00000000-0000-0000-0000-000000000004' },
      data: { isActive: true },
    });
  });
});

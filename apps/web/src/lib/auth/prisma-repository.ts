import { createPrismaClient, Prisma } from '@flightcheck/db';

import type { AuthRepository } from './service';

type PrismaClient = ReturnType<typeof createPrismaClient>;

export function createPrismaAuthRepository(
  prisma: PrismaClient,
): AuthRepository {
  return {
    reserveLoginAttempt: ({
      email,
      ipAddress,
      since,
      attemptedAt,
      maxAttempts,
    }) =>
      prisma.$transaction(async (transaction) => {
        const lockKeys = [
          `admin-login:account:${email}`,
          `admin-login:source:${ipAddress}`,
        ].sort();
        for (const lockKey of lockKeys) {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        }

        const attempts = await transaction.adminAuditLog.count({
          where: {
            action: 'AUTH_LOGIN_ATTEMPT_RESERVED',
            createdAt: { gte: since },
            OR: [
              { targetType: 'ADMIN_LOGIN_ACCOUNT', targetId: email },
              { ipAddress },
            ],
          },
        });
        if (attempts >= maxAttempts) return false;

        await transaction.adminAuditLog.create({
          data: {
            action: 'AUTH_LOGIN_ATTEMPT_RESERVED',
            targetType: 'ADMIN_LOGIN_ACCOUNT',
            targetId: email,
            ipAddress,
            createdAt: attemptedAt,
          },
        });
        return true;
      }),

    async createAuditLog({ action, adminId, ipAddress, metadata }) {
      await prisma.adminAuditLog.create({
        data: {
          action,
          ipAddress,
          ...(adminId ? { admin: { connect: { id: adminId } } } : {}),
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
        },
      });
    },

    async createSession({ adminId, tokenHash, expiresAt }) {
      await prisma.adminSession.create({
        data: { adminId, tokenHash, expiresAt },
      });
    },

    findAdminByEmail: (email) =>
      prisma.adminUser.findUnique({
        where: { email },
        select: { id: true, email: true, passwordHash: true, isActive: true },
      }),

    findActiveSession: ({ tokenHash, now }) =>
      prisma.adminSession.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
          admin: { isActive: true },
        },
        select: {
          admin: { select: { id: true, email: true, displayName: true } },
        },
      }),

    revokeSession: ({ tokenHash, revokedAt }) =>
      prisma.$transaction(async (transaction) => {
        const session = await transaction.adminSession.findFirst({
          where: { tokenHash, revokedAt: null },
          select: { id: true, adminId: true },
        });
        if (!session) return null;

        const revoked = await transaction.adminSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt },
        });
        return revoked.count === 1 ? { adminId: session.adminId } : null;
      }),
  };
}

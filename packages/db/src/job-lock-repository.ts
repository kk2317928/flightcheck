import type { PrismaClient } from './generated/prisma/client.js';
import { Prisma } from './generated/prisma/client.js';

export interface AcquireJobLockInput {
  name: string;
  ownerId: string;
  now: Date;
  leaseMs: number;
}

export interface JobLockRepository {
  acquire(input: AcquireJobLockInput): Promise<boolean>;
  renew(input: AcquireJobLockInput): Promise<boolean>;
  release(
    input: Pick<AcquireJobLockInput, 'name' | 'ownerId'>,
  ): Promise<boolean>;
}

export class JobLockPersistenceError extends Error {
  constructor(operation: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Failed to ${operation}${causeMessage}`, { cause });
    this.name = 'JobLockPersistenceError';
  }
}

function validateIdentity(input: { name: string; ownerId: string }): void {
  if (input.name.trim().length === 0) {
    throw new TypeError('Lock name must not be empty');
  }
  if (input.ownerId.trim().length === 0) {
    throw new TypeError('Lock ownerId must not be empty');
  }
}

function getLeaseExpiry(input: AcquireJobLockInput): Date {
  validateIdentity(input);
  if (!Number.isFinite(input.now.getTime())) {
    throw new TypeError('Lock time must be a valid Date');
  }
  if (!Number.isFinite(input.leaseMs) || input.leaseMs <= 0) {
    throw new RangeError('Lock leaseMs must be a positive finite number');
  }

  const expiresAt = new Date(input.now.getTime() + input.leaseMs);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new RangeError('Lock expiry must be a valid Date');
  }
  return expiresAt;
}

export function createJobLockRepository(
  prisma: PrismaClient,
): JobLockRepository {
  return {
    async acquire(input) {
      try {
        const expiresAt = getLeaseExpiry(input);
        const rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
          INSERT INTO "JobLock" ("name", "ownerId", "acquiredAt", "heartbeatAt", "expiresAt")
          VALUES (${input.name}, ${input.ownerId}, ${input.now}, ${input.now}, ${expiresAt})
          ON CONFLICT ("name") DO UPDATE
          SET "ownerId" = EXCLUDED."ownerId",
              "acquiredAt" = EXCLUDED."acquiredAt",
              "heartbeatAt" = EXCLUDED."heartbeatAt",
              "expiresAt" = EXCLUDED."expiresAt"
          WHERE "JobLock"."expiresAt" <= EXCLUDED."acquiredAt"
          RETURNING "name"
        `);
        return rows.length === 1;
      } catch (cause) {
        throw new JobLockPersistenceError('acquire job lock', cause);
      }
    },

    async renew(input) {
      try {
        const expiresAt = getLeaseExpiry(input);
        const result = await prisma.jobLock.updateMany({
          where: { name: input.name, ownerId: input.ownerId },
          data: { heartbeatAt: input.now, expiresAt },
        });
        return result.count === 1;
      } catch (cause) {
        throw new JobLockPersistenceError('renew job lock', cause);
      }
    },

    async release(input) {
      try {
        validateIdentity(input);
        const result = await prisma.jobLock.deleteMany({
          where: { name: input.name, ownerId: input.ownerId },
        });
        return result.count === 1;
      } catch (cause) {
        throw new JobLockPersistenceError('release job lock', cause);
      }
    },
  };
}

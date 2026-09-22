import { createPrismaClient } from '@flightcheck/db';

type PrismaClient = ReturnType<typeof createPrismaClient>;

const globalDatabase = globalThis as typeof globalThis & {
  flightcheckDatabase?: PrismaClient;
};

export function getDatabase(): PrismaClient {
  if (globalDatabase.flightcheckDatabase)
    return globalDatabase.flightcheckDatabase;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const database = createPrismaClient(databaseUrl);
  if (process.env.NODE_ENV !== 'production') {
    globalDatabase.flightcheckDatabase = database;
  }
  return database;
}

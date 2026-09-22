import { createPrismaClient } from '../src/client.js';
import { seedDatabase } from '../src/seed.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed the database.');
}

const prisma = createPrismaClient(databaseUrl);

try {
  await seedDatabase(prisma);
} finally {
  await prisma.$disconnect();
}

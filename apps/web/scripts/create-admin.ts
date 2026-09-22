import { createPrismaClient } from '@flightcheck/db';

import { hashPassword } from '../src/lib/auth/password';
import { provisionAdmin } from '../src/lib/auth/provision-admin';

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!databaseUrl || !email || !password) {
  throw new Error('DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD are required.');
}

const prisma = createPrismaClient(databaseUrl);

try {
  const admin = await provisionAdmin(
    { email, password },
    {
      findByEmail: (normalizedEmail) =>
        prisma.adminUser.findUnique({
          where: { email: normalizedEmail },
          select: { id: true },
        }),
      create: ({ email: normalizedEmail, passwordHash }) =>
        prisma.adminUser.create({
          data: { email: normalizedEmail, passwordHash },
          select: { id: true },
        }),
    },
    hashPassword,
  );
  process.stdout.write(`Created administrator ${admin.email}.\n`);
} finally {
  await prisma.$disconnect();
}

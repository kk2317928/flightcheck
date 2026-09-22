import { z } from 'zod';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12).max(256),
});

export interface AdminProvisioningRepository {
  findByEmail(email: string): Promise<{ id: string } | null>;
  create(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ id: string }>;
}

export async function provisionAdmin(
  input: { email: string; password: string },
  repository: AdminProvisioningRepository,
  hashPassword: (password: string) => Promise<string>,
) {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid administrator credentials.');

  const { email, password } = parsed.data;
  if (await repository.findByEmail(email)) {
    throw new Error(`Administrator ${email} already exists.`);
  }

  const passwordHash = await hashPassword(password);
  const admin = await repository.create({ email, passwordHash });
  return { id: admin.id, email };
}

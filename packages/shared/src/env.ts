import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  TZ: z.literal('Asia/Macau'),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith('postgresql://') || value.startsWith('postgres://'),
      {
        message:
          'DATABASE_URL must use the postgresql:// or postgres:// scheme',
      },
    ),
  TRUST_PROXY_HEADERS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(60_000),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  source: Record<string, string | undefined>,
): AppEnvironment {
  return environmentSchema.parse(source);
}

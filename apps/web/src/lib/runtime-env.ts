import { parseEnvironment, type AppEnvironment } from '@flightcheck/shared';

export function validateWebEnvironment(
  source: Record<string, string | undefined> = process.env,
): AppEnvironment {
  return parseEnvironment({ ...source, TZ: 'Asia/Macau' });
}

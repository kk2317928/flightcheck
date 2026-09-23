import { parseEnvironment, type AppEnvironment } from '@flightcheck/shared';

export function validateWebEnvironment(
  source: Record<string, string | undefined> = process.env,
): AppEnvironment {
  return parseEnvironment(normalizeWebRuntimeEnvironment(source));
}

export function normalizeWebRuntimeEnvironment(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { ...source, TZ: 'Asia/Macau' };
}

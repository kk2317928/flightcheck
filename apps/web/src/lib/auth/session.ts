import { createHash, randomBytes } from 'node:crypto';

export const ADMIN_SESSION_COOKIE = '__Host-flightcheck_admin_session';
export const ADMIN_SESSION_DURATION_MS = 8 * 60 * 60 * 1_000;

export const ADMIN_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  maxAge: ADMIN_SESSION_DURATION_MS / 1_000,
} as const;

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

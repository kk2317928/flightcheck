import { ADMIN_SESSION_COOKIE } from './session';

export function getClientIp(
  headers: Headers,
  trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === 'true',
): string {
  if (!trustProxyHeaders) return 'untrusted';

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwardedIp = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedIp || 'unknown';
}

export function getSessionCookie(headers: Headers): string | undefined {
  const cookieHeader = headers.get('cookie');
  if (!cookieHeader) return undefined;

  for (const cookie of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (name === ADMIN_SESSION_COOKIE) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return undefined;
}

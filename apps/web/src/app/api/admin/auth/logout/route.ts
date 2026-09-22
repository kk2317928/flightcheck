import { NextResponse } from 'next/server';

import { getClientIp, getSessionCookie } from '../../../../../lib/auth/http';
import { getAuthService } from '../../../../../lib/auth/runtime';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_OPTIONS,
} from '../../../../../lib/auth/session';

export async function POST(request: Request): Promise<NextResponse> {
  const rawToken = getSessionCookie(request.headers);
  if (rawToken) {
    await getAuthService().logout(rawToken, getClientIp(request.headers));
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', {
    ...ADMIN_SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}

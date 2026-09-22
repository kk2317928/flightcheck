import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getClientIp } from '../../../../../lib/auth/http';
import { getAuthService } from '../../../../../lib/auth/runtime';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_OPTIONS,
} from '../../../../../lib/auth/session';

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1_024),
});

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  const result = await getAuthService().login({
    ...parsed.data,
    ipAddress: getClientIp(request.headers),
  });

  if (!result.ok) {
    const status = result.reason === 'RATE_LIMITED' ? 429 : 401;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, result.rawToken, {
    ...ADMIN_SESSION_COOKIE_OPTIONS,
    expires: result.expiresAt,
  });
  return response;
}

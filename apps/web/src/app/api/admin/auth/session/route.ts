import { NextResponse } from 'next/server';

import { getSessionCookie } from '../../../../../lib/auth/http';
import { getAuthService } from '../../../../../lib/auth/runtime';

export async function GET(request: Request): Promise<NextResponse> {
  const rawToken = getSessionCookie(request.headers);
  const session = rawToken
    ? await getAuthService().authenticate(rawToken)
    : null;

  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  return NextResponse.json({ admin: session.admin });
}

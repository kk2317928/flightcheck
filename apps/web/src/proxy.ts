import { NextResponse, type NextRequest } from 'next/server';

import { authorizeAdminRequest } from './lib/auth/guard';
import { getAuthService } from './lib/auth/runtime';
import { ADMIN_SESSION_COOKIE } from './lib/auth/session';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  try {
    const result = await authorizeAdminRequest({
      pathname: request.nextUrl.pathname,
      rawToken: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
      authenticate: (rawToken) => getAuthService().authenticate(rawToken),
    });

    if (result.type === 'allow') return NextResponse.next();
    if (result.type === 'unauthorized') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    return NextResponse.redirect(new URL(result.location, request.url));
  } catch {
    return NextResponse.json(
      { error: 'AUTH_SERVICE_UNAVAILABLE' },
      { status: 503 },
    );
  }
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

type GuardResult =
  | Readonly<{ type: 'allow' }>
  | Readonly<{ type: 'redirect'; location: string }>
  | Readonly<{ type: 'unauthorized' }>;

const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/api/admin/auth/login']);

export async function authorizeAdminRequest(input: {
  pathname: string;
  rawToken: string | undefined;
  authenticate: (rawToken: string) => Promise<unknown>;
}): Promise<GuardResult> {
  if (PUBLIC_ADMIN_PATHS.has(input.pathname)) return { type: 'allow' };

  const session = input.rawToken
    ? await input.authenticate(input.rawToken)
    : null;
  if (session) return { type: 'allow' };

  if (input.pathname.startsWith('/api/admin/')) {
    return { type: 'unauthorized' };
  }

  return {
    type: 'redirect',
    location: `/admin/login?next=${encodeURIComponent(input.pathname)}`,
  };
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOrigin } from '../../../../lib/admin/http';
import { getAdminOperationRuntime } from '../../../../lib/admin/runtime';
const Body = z.object({ serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export async function POST(request: Request) {
  const runtime = getAdminOperationRuntime();
  const admin = await runtime.authenticate(request);
  if (!admin)
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!isSameOrigin(request))
    return NextResponse.json({ error: 'FORBIDDEN_ORIGIN' }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  return NextResponse.json(
    await runtime.sync({
      adminId: admin.admin.id,
      serviceDate: parsed.data.serviceDate,
    }),
  );
}

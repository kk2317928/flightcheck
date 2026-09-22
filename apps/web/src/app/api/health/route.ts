import { getWebHealth } from '@/lib/health';

export function GET(): Response {
  return Response.json(getWebHealth());
}

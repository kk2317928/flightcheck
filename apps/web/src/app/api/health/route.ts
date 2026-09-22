import {
  CORRELATION_ID_HEADER,
  getOrCreateRequestCorrelationId,
} from '@flightcheck/shared';

import { getWebHealth } from '../../../lib/health';

export function GET(request: Request): Response {
  const correlationId = getOrCreateRequestCorrelationId(request.headers);

  return Response.json(getWebHealth(), {
    headers: { [CORRELATION_ID_HEADER]: correlationId },
  });
}

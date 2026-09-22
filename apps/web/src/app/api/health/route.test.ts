import { describe, expect, it } from 'vitest';

import { CORRELATION_ID_HEADER } from '@flightcheck/shared';

import { GET } from './route';

describe('GET /api/health', () => {
  it('echoes a valid request correlation ID in the response', async () => {
    const request = new Request('http://localhost/api/health', {
      headers: { [CORRELATION_ID_HEADER]: 'request-123' },
    });

    const response = GET(request);

    expect(response.headers.get(CORRELATION_ID_HEADER)).toBe('request-123');
    await expect(response.json()).resolves.toEqual({
      service: 'web',
      status: 'ok',
    });
  });
});

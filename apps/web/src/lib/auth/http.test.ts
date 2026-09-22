import { describe, expect, it } from 'vitest';

import { getClientIp } from './http';

describe('getClientIp', () => {
  const spoofedHeaders = new Headers({
    'x-real-ip': '203.0.113.8',
    'x-forwarded-for': '198.51.100.4, 192.0.2.1',
  });

  it('does not trust caller-controlled forwarding headers by default', () => {
    expect(getClientIp(spoofedHeaders, false)).toBe('untrusted');
  });

  it('uses ingress headers only when a trusted proxy is explicitly configured', () => {
    expect(getClientIp(spoofedHeaders, true)).toBe('203.0.113.8');
  });
});

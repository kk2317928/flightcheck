import { describe, expect, it } from 'vitest';

import { getMacauDateKey, startOfMacauDateUtc } from './time.js';

describe('Macau time helpers', () => {
  it('changes service date at Macau midnight', () => {
    expect(getMacauDateKey(new Date('2026-09-21T15:59:59.999Z'))).toBe(
      '2026-09-21',
    );
    expect(getMacauDateKey(new Date('2026-09-21T16:00:00.000Z'))).toBe(
      '2026-09-22',
    );
  });

  it('converts a Macau date start to its UTC instant', () => {
    expect(startOfMacauDateUtc('2026-09-22').toISOString()).toBe(
      '2026-09-21T16:00:00.000Z',
    );
  });

  it('rejects impossible calendar dates', () => {
    expect(() => startOfMacauDateUtc('2026-02-30')).toThrow(
      /valid calendar date/,
    );
  });
});

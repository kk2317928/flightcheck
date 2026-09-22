import { describe, expect, it } from 'vitest';

import { defaultSettings, defaultSocialTemplates } from '../src/seed-data.js';

describe('seed data', () => {
  it('provides both required social templates', () => {
    expect(defaultSocialTemplates.map(({ type }) => type).sort()).toEqual([
      'CANCELLED',
      'DAILY_SUMMARY',
    ]);
  });

  it('provides operational defaults without credentials', () => {
    const serialized = JSON.stringify(defaultSettings);

    expect(defaultSettings.length).toBeGreaterThan(0);
    expect(serialized).not.toMatch(/password|access.?token|session.?token/i);
  });
});

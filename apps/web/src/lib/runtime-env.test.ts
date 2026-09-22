import { describe, expect, it } from 'vitest';

import { validateWebEnvironment } from './runtime-env';

describe('validateWebEnvironment', () => {
  it('fails when the Macau time zone is missing', () => {
    expect(() => validateWebEnvironment({})).toThrow(/TZ/);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('flight-source package boundary', () => {
  it('does not depend on an HTML parser in the contract task', () => {
    const packagePath = fileURLToPath(
      new URL('../package.json', import.meta.url),
    );
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies ?? {})).toEqual(['zod']);
  });
});

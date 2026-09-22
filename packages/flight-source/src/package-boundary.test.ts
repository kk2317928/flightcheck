import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('flight-source package boundary', () => {
  it('keeps HTML parser dependencies out of the domain contracts', () => {
    const packagePath = fileURLToPath(
      new URL('../package.json', import.meta.url),
    );
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies ?? {})).toEqual(
      expect.arrayContaining(['cheerio', 'zod']),
    );

    const contractsPath = fileURLToPath(
      new URL('./contracts.ts', import.meta.url),
    );
    expect(readFileSync(contractsPath, 'utf8')).not.toMatch(/cheerio/i);
  });
});

import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password';

describe('Argon2id passwords', () => {
  it('hashes and verifies without retaining the raw password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
    expect(hash).toContain('p=1');
    await expect(
      verifyPassword(hash, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
    expect(hash).not.toContain('correct horse battery staple');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { provisionAdmin } from './provision-admin';

describe('provisionAdmin', () => {
  it('normalizes the email and stores an Argon2id password hash', async () => {
    const repository = {
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'admin-1' }),
    };
    const hash = vi.fn().mockResolvedValue('$argon2id$hash');

    await expect(
      provisionAdmin(
        {
          email: ' Admin@Example.com ',
          password: 'correct horse battery staple',
        },
        repository,
        hash,
      ),
    ).resolves.toEqual({ id: 'admin-1', email: 'admin@example.com' });
    expect(repository.create).toHaveBeenCalledWith({
      email: 'admin@example.com',
      passwordHash: '$argon2id$hash',
    });
  });

  it('refuses to overwrite an existing administrator', async () => {
    const repository = {
      findByEmail: vi.fn().mockResolvedValue({ id: 'admin-1' }),
      create: vi.fn(),
    };

    await expect(
      provisionAdmin(
        {
          email: 'admin@example.com',
          password: 'correct horse battery staple',
        },
        repository,
        vi.fn(),
      ),
    ).rejects.toThrow(/already exists/i);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects weak bootstrap credentials', async () => {
    const repository = { findByEmail: vi.fn(), create: vi.fn() };

    await expect(
      provisionAdmin(
        { email: 'not-an-email', password: 'short' },
        repository,
        vi.fn(),
      ),
    ).rejects.toThrow(/credentials/i);
  });
});

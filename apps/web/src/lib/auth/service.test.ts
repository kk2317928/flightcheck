import { describe, expect, it, vi } from 'vitest';

import { createAuthService, type AuthRepository } from './service';

function createRepository(
  overrides: Partial<AuthRepository> = {},
): AuthRepository {
  return {
    reserveLoginAttempt: vi.fn().mockResolvedValue(true),
    createAuditLog: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(undefined),
    findAdminByEmail: vi.fn().mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      passwordHash: 'stored-hash',
      isActive: true,
    }),
    findActiveSession: vi.fn().mockResolvedValue(null),
    revokeSession: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('admin authentication service', () => {
  const now = new Date('2026-09-22T10:00:00.000Z');

  it('creates an expiring hashed session and login audit', async () => {
    const repository = createRepository();
    const service = createAuthService(repository, {
      now: () => now,
      verifyPassword: vi.fn().mockResolvedValue(true),
    });

    const result = await service.login({
      email: ' ADMIN@example.com ',
      password: 'secret',
      ipAddress: '203.0.113.8',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawToken).not.toBe(result.tokenHash);
    expect(result.expiresAt).toEqual(new Date('2026-09-22T18:00:00.000Z'));
    expect(repository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-1',
        tokenHash: result.tokenHash,
      }),
    );
    expect(repository.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUTH_LOGIN_SUCCEEDED',
        adminId: 'admin-1',
      }),
    );
  });

  it('blocks attempts when no atomic rate-limit reservation is available', async () => {
    const verifyPassword = vi.fn().mockResolvedValue(true);
    const repository = createRepository({
      reserveLoginAttempt: vi.fn().mockResolvedValue(false),
    });
    const service = createAuthService(repository, {
      now: () => now,
      verifyPassword,
    });

    await expect(
      service.login({
        email: 'admin@example.com',
        password: 'secret',
        ipAddress: '203.0.113.8',
      }),
    ).resolves.toEqual({ ok: false, reason: 'RATE_LIMITED' });
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('reserves account and source capacity before password verification', async () => {
    const events: string[] = [];
    const repository = createRepository({
      reserveLoginAttempt: vi.fn().mockImplementation(() => {
        events.push('reserved');
        return Promise.resolve(true);
      }),
      findAdminByEmail: vi.fn().mockImplementation(() => {
        events.push('lookup');
        return Promise.resolve(null);
      }),
    });
    const service = createAuthService(repository, {
      now: () => now,
      verifyPassword: vi.fn().mockImplementation(() => {
        events.push('verified');
        return Promise.resolve(false);
      }),
    });

    await service.login({
      email: ' Admin@example.com ',
      password: 'guess',
      ipAddress: 'untrusted',
    });

    expect(repository.reserveLoginAttempt).toHaveBeenCalledWith({
      email: 'admin@example.com',
      ipAddress: 'untrusted',
      since: new Date('2026-09-22T09:45:00.000Z'),
      attemptedAt: now,
      maxAttempts: 5,
    });
    expect(events).toEqual(['reserved', 'lookup', 'verified']);
  });

  it('limits concurrent requests before expensive password verification', async () => {
    let reservations = 0;
    const verifyPassword = vi.fn().mockResolvedValue(false);
    const repository = createRepository({
      reserveLoginAttempt: vi
        .fn()
        .mockImplementation(() => Promise.resolve(reservations++ < 5)),
      findAdminByEmail: vi.fn().mockResolvedValue(null),
    });
    const service = createAuthService(repository, {
      now: () => now,
      verifyPassword,
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.login({
          email: 'admin@example.com',
          password: 'guess',
          ipAddress: 'untrusted',
        }),
      ),
    );

    expect(verifyPassword).toHaveBeenCalledTimes(5);
    expect(
      results.filter((result) => result.reason === 'RATE_LIMITED'),
    ).toHaveLength(15);
  });

  it('performs dummy verification for unknown emails to reduce timing leaks', async () => {
    const verifyPassword = vi.fn().mockResolvedValue(false);
    const repository = createRepository({
      findAdminByEmail: vi.fn().mockResolvedValue(null),
    });
    const service = createAuthService(repository, {
      now: () => now,
      verifyPassword,
    });

    await service.login({
      email: 'unknown@example.com',
      password: 'guess',
      ipAddress: '203.0.113.8',
    });

    expect(verifyPassword).toHaveBeenCalledOnce();
    expect(verifyPassword).toHaveBeenCalledWith(
      expect.stringMatching(/^\$argon2id\$/),
      'guess',
    );
  });

  it('revokes logout tokens and makes them unusable', async () => {
    const repository = createRepository({
      revokeSession: vi.fn().mockResolvedValue({ adminId: 'admin-1' }),
    });
    const service = createAuthService(repository, {
      now: () => now,
      verifyPassword: vi.fn(),
    });

    await service.logout('raw-session', '203.0.113.8');

    expect(repository.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: now }),
    );
    expect(repository.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_LOGOUT', adminId: 'admin-1' }),
    );
  });
});

import { verifyPassword as verifyArgon2Password } from './password';
import {
  ADMIN_SESSION_DURATION_MS,
  createSessionToken,
  hashSessionToken,
} from './session';

const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_FAILURES = 5;
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$rTK2Nxljp+BLDfsTAp3T1g$iQvBAswHuiL+SYJFiwD1NzsMj35xyKy25BNK1+UO0Ak';

type AdminRecord = Readonly<{
  id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
}>;

type SessionAdmin = Readonly<{
  id: string;
  email: string;
  displayName: string | null;
}>;

export type AuthRepository = Readonly<{
  reserveLoginAttempt: (input: {
    email: string;
    ipAddress: string;
    since: Date;
    attemptedAt: Date;
    maxAttempts: number;
  }) => Promise<boolean>;
  createAuditLog: (input: {
    action: string;
    adminId?: string;
    ipAddress: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  createSession: (input: {
    adminId: string;
    tokenHash: string;
    expiresAt: Date;
  }) => Promise<void>;
  findAdminByEmail: (email: string) => Promise<AdminRecord | null>;
  findActiveSession: (input: {
    tokenHash: string;
    now: Date;
  }) => Promise<{ admin: SessionAdmin } | null>;
  revokeSession: (input: {
    tokenHash: string;
    revokedAt: Date;
  }) => Promise<{ adminId: string } | null>;
}>;

type AuthDependencies = Readonly<{
  now?: () => Date;
  verifyPassword?: (hash: string, password: string) => Promise<boolean>;
}>;

export function createAuthService(
  repository: AuthRepository,
  {
    now = () => new Date(),
    verifyPassword = verifyArgon2Password,
  }: AuthDependencies = {},
) {
  return {
    async login(input: { email: string; password: string; ipAddress: string }) {
      const currentTime = now();
      const normalizedEmail = input.email.trim().toLowerCase();
      const reserved = await repository.reserveLoginAttempt({
        email: normalizedEmail,
        ipAddress: input.ipAddress,
        since: new Date(currentTime.getTime() - LOGIN_WINDOW_MS),
        attemptedAt: currentTime,
        maxAttempts: MAX_LOGIN_FAILURES,
      });
      if (!reserved) {
        return { ok: false, reason: 'RATE_LIMITED' } as const;
      }

      const admin = await repository.findAdminByEmail(normalizedEmail);
      const passwordMatches = await verifyPassword(
        admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
        input.password,
      );

      if (!admin || !admin.isActive || !passwordMatches) {
        await repository.createAuditLog({
          action: 'AUTH_LOGIN_FAILED',
          ...(admin ? { adminId: admin.id } : {}),
          ipAddress: input.ipAddress,
          metadata: { email: normalizedEmail },
        });
        return { ok: false, reason: 'INVALID_CREDENTIALS' } as const;
      }

      const rawToken = createSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const expiresAt = new Date(
        currentTime.getTime() + ADMIN_SESSION_DURATION_MS,
      );
      await repository.createSession({
        adminId: admin.id,
        tokenHash,
        expiresAt,
      });
      await repository.createAuditLog({
        action: 'AUTH_LOGIN_SUCCEEDED',
        adminId: admin.id,
        ipAddress: input.ipAddress,
      });

      return {
        ok: true,
        rawToken,
        tokenHash,
        expiresAt,
        adminId: admin.id,
      } as const;
    },

    async authenticate(rawToken: string) {
      if (!rawToken) return null;
      return repository.findActiveSession({
        tokenHash: hashSessionToken(rawToken),
        now: now(),
      });
    },

    async logout(rawToken: string, ipAddress: string): Promise<void> {
      if (!rawToken) return;
      const revokedAt = now();
      const session = await repository.revokeSession({
        tokenHash: hashSessionToken(rawToken),
        revokedAt,
      });
      if (session) {
        await repository.createAuditLog({
          action: 'AUTH_LOGOUT',
          adminId: session.adminId,
          ipAddress,
        });
      }
    },
  };
}

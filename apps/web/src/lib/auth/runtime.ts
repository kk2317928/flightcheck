import { getDatabase } from '../db';
import { createPrismaAuthRepository } from './prisma-repository';
import { createAuthService } from './service';

export function getAuthService() {
  return createAuthService(createPrismaAuthRepository(getDatabase()));
}

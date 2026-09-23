import { Prisma } from '@flightcheck/db';
import { createWorkerServices } from '@flightcheck/worker/composition';
import { getSessionCookie } from '../auth/http';
import { getAuthService } from '../auth/runtime';
import { createAdminOperations } from './operations';
import { normalizeWebRuntimeEnvironment } from '../runtime-env';

let runtime: ReturnType<typeof buildRuntime> | undefined;
function buildRuntime() {
  const services = createWorkerServices(
    normalizeWebRuntimeEnvironment(process.env),
  );
  const operations = createAdminOperations({
    flightSync: services.flightSyncService,
    statistics: services.statisticsService,
    audit: async ({ action, adminId, serviceDate, resultCode }) => {
      await services.prisma.adminAuditLog.create({
        data: {
          adminId,
          action,
          targetType: 'SERVICE_DATE',
          targetId: serviceDate,
          metadata: { resultCode } satisfies Prisma.InputJsonObject,
        },
      });
    },
  });
  return {
    authenticate: async (request: Request) => {
      const token = getSessionCookie(request.headers);
      return token ? getAuthService().authenticate(token) : null;
    },
    ...operations,
  };
}
export function getAdminOperationRuntime() {
  return (runtime ??= buildRuntime());
}

import { getMacauDateKey } from '@flightcheck/shared';

const DAY_MS = 86_400_000;

interface CronServices {
  flightSyncService: {
    run(input: {
      serviceDate: string;
      trigger: 'SCHEDULED';
    }): Promise<{ status: string }>;
  };
  statisticsService: {
    recalculate(input: {
      serviceDate: string;
      trigger: 'SCHEDULED';
    }): Promise<unknown>;
  };
  prisma: { $disconnect(): Promise<void> };
}

export function createCronDispatch(dependencies: {
  secret: string | undefined;
  now: () => Date;
  buildServices: () => CronServices;
}) {
  return async (request: Request): Promise<Response> => {
    if (
      !dependencies.secret ||
      request.headers.get('authorization') !== `Bearer ${dependencies.secret}`
    ) {
      return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const now = dependencies.now();
    const serviceDate = getMacauDateKey(now);
    const services = dependencies.buildServices();
    try {
      const sync = await services.flightSyncService.run({
        serviceDate,
        trigger: 'SCHEDULED',
      });
      const statistics = [serviceDate];
      await services.statisticsService.recalculate({
        serviceDate,
        trigger: 'SCHEDULED',
      });

      const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
      if (minutes >= 5 && minutes <= 420) {
        const yesterday = getMacauDateKey(new Date(now.getTime() - DAY_MS));
        await services.statisticsService.recalculate({
          serviceDate: yesterday,
          trigger: 'SCHEDULED',
        });
        statistics.push(yesterday);
      }

      return Response.json(
        { serviceDate, syncStatus: sync.status, statistics },
        { status: sync.status === 'FAILED' ? 503 : 200 },
      );
    } finally {
      await services.prisma.$disconnect();
    }
  };
}

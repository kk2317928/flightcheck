import type {
  DataQuality,
  FlightDirection,
  OperationalStatus,
  PerformanceStatus,
  PrismaClient,
  ScrapeRunStatus,
  ScrapeSource,
  SettlementStatus,
} from './generated/prisma/client.js';
import { Prisma } from './generated/prisma/client.js';

export interface SaveDailyStatisticInput {
  serviceDate: string;
  totalFlights: number;
  departureFlights: number;
  arrivalFlights: number;
  determinedFlights: number;
  pendingFlights: number;
  onTimeFlights: number;
  delayedFlights: number;
  severeDelayedFlights: number;
  cancelledFlights: number;
  unknownFlights: number;
  cancellationRate: number | null;
  onTimeRate: number | null;
  averageDelayMinutes: number | null;
  dataQuality: DataQuality;
  settlementStatus: SettlementStatus;
  cutoffAt: Date;
  settledAt: Date | null;
  warningSummary: Prisma.InputJsonValue;
  trigger: 'SCHEDULED' | 'MANUAL' | 'RECOVERY';
}

export interface StatisticsFlightRecord {
  direction: FlightDirection;
  operationalStatus: OperationalStatus;
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
}

export interface StatisticsSourceRun {
  source: ScrapeSource;
  status: ScrapeRunStatus;
  finishedAt: Date | null;
  fetchedAt: Date | null;
  warningCount: number;
  warnings: Prisma.JsonValue | null;
}

export interface LoadStatisticsSourceInput {
  serviceDate: string;
  windowStart: Date;
  windowEnd: Date;
}

export interface StatisticsSourceData {
  flights: StatisticsFlightRecord[];
  departures: StatisticsSourceRun | null;
  arrivals: StatisticsSourceRun | null;
}

export interface StatisticsRepository {
  loadStatisticsSource(
    input: LoadStatisticsSourceInput,
  ): Promise<StatisticsSourceData>;
  saveDailyStatistic(input: SaveDailyStatisticInput): Promise<{
    totalFlights: number;
    settlementStatus: SettlementStatus;
    settledAt: Date | null;
  }>;
}

function serviceDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function createStatisticsRepository(
  prisma: PrismaClient,
): StatisticsRepository {
  return {
    async loadStatisticsSource(input) {
      const [flights, departures, arrivals] = await Promise.all([
        prisma.flightInstance.findMany({
          where: { serviceDate: serviceDate(input.serviceDate) },
          select: {
            direction: true,
            operationalStatus: true,
            performanceStatus: true,
            delayMinutes: true,
          },
        }),
        prisma.scrapeRun.findFirst({
          where: {
            source: 'DEPARTURES',
            status: { in: ['SUCCESS', 'PARTIAL'] },
            finishedAt: { gte: input.windowStart, lt: input.windowEnd },
          },
          orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
          select: {
            source: true,
            status: true,
            finishedAt: true,
            fetchedAt: true,
            warningCount: true,
            warnings: true,
          },
        }),
        prisma.scrapeRun.findFirst({
          where: {
            source: 'ARRIVALS',
            status: { in: ['SUCCESS', 'PARTIAL'] },
            finishedAt: { gte: input.windowStart, lt: input.windowEnd },
          },
          orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
          select: {
            source: true,
            status: true,
            finishedAt: true,
            fetchedAt: true,
            warningCount: true,
            warnings: true,
          },
        }),
      ]);
      return { flights, departures, arrivals };
    },

    async saveDailyStatistic(input) {
      return prisma.$transaction(
        async (transaction) => {
          const date = serviceDate(input.serviceDate);
          const existing = await transaction.dailyStatistic.findUnique({
            where: { serviceDate: date },
          });
          const mayReplaceFinal =
            input.trigger === 'MANUAL' && input.settlementStatus === 'FINAL';
          if (existing?.settlementStatus === 'FINAL' && !mayReplaceFinal) {
            return existing;
          }

          const data = {
            totalFlights: input.totalFlights,
            departureFlights: input.departureFlights,
            arrivalFlights: input.arrivalFlights,
            determinedFlights: input.determinedFlights,
            pendingFlights: input.pendingFlights,
            onTimeFlights: input.onTimeFlights,
            delayedFlights: input.delayedFlights,
            severeDelayedFlights: input.severeDelayedFlights,
            cancelledFlights: input.cancelledFlights,
            unknownFlights: input.unknownFlights,
            cancellationRate: input.cancellationRate,
            onTimeRate: input.onTimeRate,
            averageDelayMinutes: input.averageDelayMinutes,
            dataQuality: input.dataQuality,
            settlementStatus: input.settlementStatus,
            cutoffAt: input.cutoffAt,
            settledAt: input.settledAt,
            warningSummary: input.warningSummary,
          };
          return transaction.dailyStatistic.upsert({
            where: { serviceDate: date },
            create: { serviceDate: date, ...data },
            update: data,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  };
}

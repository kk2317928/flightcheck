import {
  FlightSourceWarningSchema,
  type FlightSourceWarning,
} from '@flightcheck/flight-source';

import type {
  OperationalStatus,
  PerformanceStatus,
  PrismaClient,
} from './generated/prisma/client.js';
import { Prisma } from './generated/prisma/client.js';

export interface StartScrapeRunInput {
  source: 'DEPARTURES' | 'ARRIVALS';
  correlationId: string;
  startedAt: Date;
}

export interface CompleteScrapeRunInput {
  id: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  finishedAt: Date;
  fetchedAt: Date | null;
  sourceUpdatedAt: Date | null;
  rowCount: number;
  nxFlightCount: number;
  warningCount: number;
  warnings: readonly FlightSourceWarning[];
  errorCode: string | null;
}

export interface FlightStatusState {
  operationalStatus: OperationalStatus;
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
  scheduleVarianceMinutes: number | null;
  cancelledObservedCount: number;
  cancelConfirmedAt: Date | null;
  lastStatusObservedAt: Date | null;
}

export interface FlightSyncRepository {
  startScrapeRun(input: StartScrapeRunInput): Promise<{ id: string }>;
  completeScrapeRun(input: CompleteScrapeRunInput): Promise<void>;
  getFlightStatusState(flightInstanceId: string): Promise<FlightStatusState>;
}

export class FlightSyncPersistenceError extends Error {
  constructor(operation: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Failed to ${operation}${causeMessage}`, { cause });
    this.name = 'FlightSyncPersistenceError';
  }
}

export function createFlightSyncRepository(
  prisma: PrismaClient,
): FlightSyncRepository {
  return {
    async startScrapeRun(input) {
      try {
        return await prisma.scrapeRun.create({
          data: {
            source: input.source,
            status: 'RUNNING',
            correlationId: input.correlationId,
            startedAt: input.startedAt,
          },
          select: { id: true },
        });
      } catch (cause) {
        throw new FlightSyncPersistenceError('start scrape run', cause);
      }
    },

    async completeScrapeRun(input) {
      try {
        const warnings = input.warnings.map((warning) =>
          FlightSourceWarningSchema.parse(warning),
        );
        if (warnings.length !== input.warningCount) {
          throw new Error('warningCount does not match warnings length');
        }
        const result = await prisma.scrapeRun.updateMany({
          where: { id: input.id, status: 'RUNNING' },
          data: {
            status: input.status,
            finishedAt: input.finishedAt,
            fetchedAt: input.fetchedAt,
            sourceUpdatedAt: input.sourceUpdatedAt,
            rowCount: input.rowCount,
            nxFlightCount: input.nxFlightCount,
            warningCount: input.warningCount,
            warnings: warnings as unknown as Prisma.InputJsonArray,
            errorCode: input.errorCode,
          },
        });
        if (result.count !== 1) {
          throw new Error('Scrape run is missing or already completed');
        }
      } catch (cause) {
        throw new FlightSyncPersistenceError('complete scrape run', cause);
      }
    },

    async getFlightStatusState(flightInstanceId) {
      try {
        return await prisma.flightInstance.findUniqueOrThrow({
          where: { id: flightInstanceId },
          select: {
            operationalStatus: true,
            performanceStatus: true,
            delayMinutes: true,
            scheduleVarianceMinutes: true,
            cancelledObservedCount: true,
            cancelConfirmedAt: true,
            lastStatusObservedAt: true,
          },
        });
      } catch (cause) {
        throw new FlightSyncPersistenceError('load flight status state', cause);
      }
    },
  };
}

import type {
  SaveDailyStatisticInput,
  StatisticsRepository,
  StatisticsSourceRun,
} from '@flightcheck/db';
import {
  aggregateDailyStatistics,
  evaluateDataQuality,
  type DataQualitySourceEvidence,
} from '@flightcheck/domain';
import { startOfMacauDateUtc } from '@flightcheck/shared';

const MINUTE_MS = 60_000;
const CUTOFF_MINUTES = 23 * 60 + 30;
const SETTLEMENT_START_MINUTES = 24 * 60 + 5;
const SETTLEMENT_DEADLINE_MINUTES = 30 * 60;
const MAX_SOURCE_AGE_MINUTES = 15;
const CRITICAL_WARNING_CODES = new Set(['MALFORMED_ROW', 'SOURCE_PARTIAL']);

export interface StatisticsService {
  recalculate(input: {
    serviceDate: string;
    trigger: SaveDailyStatisticInput['trigger'];
  }): Promise<SaveDailyStatisticInput>;
}

function countCriticalWarnings(run: StatisticsSourceRun): number {
  let critical = run.status === 'PARTIAL' ? 1 : 0;
  if (!Array.isArray(run.warnings)) return critical;

  for (const warning of run.warnings) {
    if (
      typeof warning === 'object' &&
      warning !== null &&
      'code' in warning &&
      typeof warning.code === 'string' &&
      CRITICAL_WARNING_CODES.has(warning.code)
    ) {
      critical += 1;
    }
  }
  return critical;
}

function sourceEvidence(
  run: StatisticsSourceRun | null,
): DataQualitySourceEvidence | null {
  if (run === null) return null;
  const lastSuccessfulAt = run.fetchedAt ?? run.finishedAt;
  if (lastSuccessfulAt === null) return null;
  return {
    lastSuccessfulAt,
    warningCount: run.warningCount,
    criticalWarningCount: countCriticalWarnings(run),
  };
}

export function createStatisticsService(dependencies: {
  repository: StatisticsRepository;
  now: () => Date;
}): StatisticsService {
  return {
    async recalculate(input) {
      const now = dependencies.now();
      const dayStart = startOfMacauDateUtc(input.serviceDate);
      const cutoffAt = new Date(
        dayStart.getTime() + CUTOFF_MINUTES * MINUTE_MS,
      );
      const settlementStart = new Date(
        dayStart.getTime() + SETTLEMENT_START_MINUTES * MINUTE_MS,
      );
      const settlementDeadline = new Date(
        dayStart.getTime() + SETTLEMENT_DEADLINE_MINUTES * MINUTE_MS,
      );
      const source = await dependencies.repository.loadStatisticsSource({
        serviceDate: input.serviceDate,
        windowStart: dayStart,
        windowEnd: new Date(cutoffAt.getTime() + 1),
      });
      const statistics = aggregateDailyStatistics({
        serviceDate: input.serviceDate,
        cutoffAt,
        flights: source.flights,
      });
      const quality = evaluateDataQuality({
        evaluatedAt: cutoffAt,
        cutoffAt,
        maxAgeMinutes: MAX_SOURCE_AGE_MINUTES,
        departures: sourceEvidence(source.departures),
        arrivals: sourceEvidence(source.arrivals),
      });

      const canSettle =
        now >= settlementStart &&
        quality.quality === 'COMPLETE' &&
        statistics.pendingFlights === 0;
      const deadlineReached = now >= settlementDeadline;
      const settlementStatus = canSettle
        ? 'FINAL'
        : deadlineReached
          ? 'FINAL_WITH_WARNINGS'
          : 'PRELIMINARY';
      const candidate: SaveDailyStatisticInput = {
        ...statistics,
        dataQuality: quality.quality,
        settlementStatus,
        settledAt: settlementStatus === 'PRELIMINARY' ? null : now,
        warningSummary: {
          reasons: quality.reasons,
          warnings: quality.warningSummary,
          lastSuccessfulAt: quality.lastSuccessfulAt?.toISOString() ?? null,
        },
        trigger: input.trigger,
      };
      const saved = await dependencies.repository.saveDailyStatistic(candidate);
      return {
        ...candidate,
        totalFlights: saved.totalFlights,
        settlementStatus: saved.settlementStatus,
        settledAt: saved.settledAt,
      };
    },
  };
}

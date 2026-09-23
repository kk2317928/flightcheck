/* eslint-disable @typescript-eslint/require-await */
import type {
  SaveDailyStatisticInput,
  StatisticsRepository,
  StatisticsSourceData,
} from '@flightcheck/db';
import { describe, expect, it } from 'vitest';

import { createStatisticsService } from './statistics-service.js';

const source: StatisticsSourceData = {
  flights: [
    {
      direction: 'DEPARTURE',
      operationalStatus: 'DEPARTED',
      performanceStatus: 'ON_TIME',
      delayMinutes: 0,
    },
    {
      direction: 'ARRIVAL',
      operationalStatus: 'ARRIVED',
      performanceStatus: 'DELAYED',
      delayMinutes: 20,
    },
  ],
  departures: {
    source: 'DEPARTURES',
    status: 'SUCCESS',
    finishedAt: new Date('2026-09-22T15:29:30.000Z'),
    fetchedAt: new Date('2026-09-22T15:29:00.000Z'),
    warningCount: 0,
    warnings: [],
  },
  arrivals: {
    source: 'ARRIVALS',
    status: 'SUCCESS',
    finishedAt: new Date('2026-09-22T15:29:30.000Z'),
    fetchedAt: new Date('2026-09-22T15:29:00.000Z'),
    warningCount: 0,
    warnings: [],
  },
};

function harness(now: Date, sourceData: StatisticsSourceData = source) {
  const saved: SaveDailyStatisticInput[] = [];
  const repository: StatisticsRepository = {
    loadStatisticsSource: async () => sourceData,
    saveDailyStatistic: async (input) => {
      saved.push(input);
      return {
        totalFlights: input.totalFlights,
        settlementStatus: input.settlementStatus,
        settledAt: input.settledAt,
      };
    },
  };
  return {
    saved,
    service: createStatisticsService({ repository, now: () => now }),
  };
}

describe('StatisticsService', () => {
  it('writes a PRELIMINARY snapshot at the 23:30 Macau cutoff', async () => {
    const { service, saved } = harness(new Date('2026-09-22T15:30:00.000Z'));

    await expect(
      service.recalculate({
        serviceDate: '2026-09-22',
        trigger: 'SCHEDULED',
      }),
    ).resolves.toMatchObject({
      settlementStatus: 'PRELIMINARY',
      dataQuality: 'COMPLETE',
      totalFlights: 2,
    });
    expect(saved[0]).toMatchObject({
      cutoffAt: new Date('2026-09-22T15:30:00.000Z'),
      settlementStatus: 'PRELIMINARY',
      settledAt: null,
    });
  });

  it('settles complete determined data as FINAL from 00:05 Macau', async () => {
    const { service } = harness(new Date('2026-09-22T16:05:00.000Z'));

    await expect(
      service.recalculate({
        serviceDate: '2026-09-22',
        trigger: 'SCHEDULED',
      }),
    ).resolves.toMatchObject({
      settlementStatus: 'FINAL',
      dataQuality: 'COMPLETE',
    });
  });

  it('keeps incomplete data preliminary before the 06:00 deadline', async () => {
    const { service } = harness(new Date('2026-09-22T17:05:00.000Z'), {
      ...source,
      arrivals: null,
    });

    await expect(
      service.recalculate({
        serviceDate: '2026-09-22',
        trigger: 'SCHEDULED',
      }),
    ).resolves.toMatchObject({
      settlementStatus: 'PRELIMINARY',
      dataQuality: 'DEGRADED',
    });
  });

  it('settles incomplete data as FINAL_WITH_WARNINGS at 06:00 Macau', async () => {
    const { service } = harness(new Date('2026-09-22T22:00:00.000Z'), {
      ...source,
      arrivals: null,
    });

    await expect(
      service.recalculate({
        serviceDate: '2026-09-22',
        trigger: 'RECOVERY',
      }),
    ).resolves.toMatchObject({
      settlementStatus: 'FINAL_WITH_WARNINGS',
      dataQuality: 'DEGRADED',
      settledAt: new Date('2026-09-22T22:00:00.000Z'),
    });
  });
});

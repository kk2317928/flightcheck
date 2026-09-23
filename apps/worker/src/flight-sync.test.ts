/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import type {
  FlightObservationRepository,
  FlightStatusState,
  FlightSyncRepository,
  JobLockRepository,
  PersistedFlightObservation,
} from '@flightcheck/db';
import type {
  ApplyFlightStatusObservationInput,
  StatusApplicationResult,
} from '@flightcheck/domain';
import type {
  FlightSourceAdapter,
  FlightSourceFetchResult,
  NormalizedFlight,
} from '@flightcheck/flight-source';
import { describe, expect, it, vi } from 'vitest';

import { createFlightSyncService } from './flight-sync.js';

const observedAt = new Date('2026-09-22T08:05:00.000Z');
const initialState: FlightStatusState = {
  operationalStatus: 'SCHEDULED',
  performanceStatus: 'PENDING',
  delayMinutes: null,
  scheduleVarianceMinutes: null,
  cancelledObservedCount: 0,
  cancelConfirmedAt: null,
  lastStatusObservedAt: null,
};
const departure: NormalizedFlight = {
  flightNumber: 'NX001',
  serviceDate: '2026-09-22',
  direction: 'DEPARTURE',
  scheduledAt: new Date('2026-09-22T08:00:00.000Z'),
  estimatedAt: null,
  actualAt: null,
  origin: { code: 'MFM', name: 'Macau' },
  destination: { code: 'TPE', name: 'Taipei' },
  sourceStatus: 'SCHEDULED',
  rawStatus: 'Scheduled',
};
const arrival: NormalizedFlight = {
  ...departure,
  direction: 'ARRIVAL',
  origin: departure.destination,
  destination: departure.origin,
};

function complete(flights: NormalizedFlight[]): FlightSourceFetchResult {
  return {
    status: 'COMPLETE',
    flights,
    fetchedAt: observedAt,
    sourceUpdatedAt: null,
    warnings: [],
    rowCount: flights.length,
  };
}

function failed(code: 'TIMEOUT' | 'HTTP_ERROR'): FlightSourceFetchResult {
  return {
    status: 'FAILED',
    flights: [],
    fetchedAt: observedAt,
    sourceUpdatedAt: null,
    warnings: [],
    rowCount: 0,
    error: { code, message: code, retryable: true },
  };
}

function createHarness(
  fetch: (direction: 'DEPARTURE' | 'ARRIVAL') => FlightSourceFetchResult = (
    direction,
  ) => complete(direction === 'DEPARTURE' ? [departure] : [arrival]),
) {
  const lock: JobLockRepository = {
    acquire: vi.fn(async () => true),
    renew: vi.fn(async () => true),
    release: vi.fn(async () => true),
  };
  const source: FlightSourceAdapter = {
    fetchFlights: vi.fn(async ({ directions }) => fetch(directions[0]!)),
  };
  let nextRun = 0;
  const syncRepository: FlightSyncRepository = {
    startScrapeRun: vi.fn(async () => ({ id: `run-${++nextRun}` })),
    completeScrapeRun: vi.fn(async () => undefined),
    getFlightStatusState: vi.fn(async () => initialState),
  };
  const observationRepository: FlightObservationRepository = {
    persistObservationBatch: vi.fn(async ({ flights, warnings }) => ({
      processedInstances: flights.length,
      insertedSnapshots: flights.length,
      unchangedSnapshots: 0,
      persistedWarnings: warnings.length,
      instances: flights.map(
        (observation: NormalizedFlight, index: number) => ({
          flightInstanceId: `instance-${observation.direction}-${index}`,
          observation,
        }),
      ),
    })),
    recordStatusTransition: vi.fn(async () => ({ changed: true })),
  };
  const applyStatusObservation = vi.fn(
    async (
      input: ApplyFlightStatusObservationInput,
    ): Promise<StatusApplicationResult> => ({
      changed: true,
      decision: {
        ...input.current,
        lastStatusObservedAt: input.observedAt,
        reason: 'SOURCE_STATUS',
      },
    }),
  );
  const service = createFlightSyncService({
    lock,
    source,
    syncRepository,
    observationRepository,
    applyStatusObservation,
    now: () => observedAt,
    createOwnerId: () => 'sync-owner',
  });
  return {
    service,
    lock,
    source,
    syncRepository,
    observationRepository,
    applyStatusObservation,
  };
}

describe('FlightSyncService', () => {
  it('skips a locked run without touching sources or scrape runs', async () => {
    const harness = createHarness();
    vi.mocked(harness.lock.acquire).mockResolvedValue(false);

    await expect(
      harness.service.run({ serviceDate: '2026-09-22', trigger: 'MANUAL' }),
    ).resolves.toEqual({
      status: 'SKIPPED_LOCKED',
      correlationId: 'sync-owner',
      directions: [],
    });
    expect(harness.source.fetchFlights).not.toHaveBeenCalled();
    expect(harness.syncRepository.startScrapeRun).not.toHaveBeenCalled();
    expect(harness.lock.release).not.toHaveBeenCalled();
  });

  it('fetches directions separately and concurrently, then releases the lease', async () => {
    const pending = new Map<
      string,
      (result: FlightSourceFetchResult) => void
    >();
    const harness = createHarness();
    vi.mocked(harness.source.fetchFlights).mockImplementation(
      async ({ directions }) =>
        new Promise((resolve) => pending.set(directions[0]!, resolve)),
    );

    const running = harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'SCHEDULED',
    });
    await vi.waitFor(() => expect(pending.size).toBe(2));
    expect(harness.source.fetchFlights).toHaveBeenCalledWith({
      serviceDate: '2026-09-22',
      directions: ['DEPARTURE'],
    });
    expect(harness.source.fetchFlights).toHaveBeenCalledWith({
      serviceDate: '2026-09-22',
      directions: ['ARRIVAL'],
    });
    pending.get('DEPARTURE')?.(complete([departure]));
    pending.get('ARRIVAL')?.(complete([arrival]));

    await expect(running).resolves.toMatchObject({ status: 'SUCCESS' });
    expect(harness.lock.release).toHaveBeenCalledWith({
      name: 'flight-sync',
      ownerId: 'sync-owner',
    });
  });

  it('isolates one source failure and reports overall PARTIAL', async () => {
    const harness = createHarness((direction) =>
      direction === 'DEPARTURE' ? complete([departure]) : failed('TIMEOUT'),
    );

    const result = await harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'STARTUP',
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.directions).toEqual([
      {
        direction: 'DEPARTURE',
        scrapeRunId: 'run-1',
        status: 'SUCCESS',
        processedFlights: 1,
        errorCode: null,
      },
      {
        direction: 'ARRIVAL',
        scrapeRunId: 'run-2',
        status: 'FAILED',
        processedFlights: 0,
        errorCode: 'TIMEOUT',
      },
    ]);
    expect(
      harness.observationRepository.persistObservationBatch,
    ).toHaveBeenCalledTimes(1);
    expect(harness.applyStatusObservation).toHaveBeenCalledTimes(1);
  });

  it('reports FAILED and never persists when both source calls fail', async () => {
    const harness = createHarness((direction) =>
      failed(direction === 'DEPARTURE' ? 'HTTP_ERROR' : 'TIMEOUT'),
    );

    await expect(
      harness.service.run({ serviceDate: '2026-09-22', trigger: 'MANUAL' }),
    ).resolves.toMatchObject({ status: 'FAILED' });
    expect(
      harness.observationRepository.persistObservationBatch,
    ).not.toHaveBeenCalled();
    expect(harness.applyStatusObservation).not.toHaveBeenCalled();
  });

  it('keeps usable PARTIAL with zero flights partial without observations', async () => {
    const warning = {
      code: 'SOURCE_PARTIAL' as const,
      message: 'Board was usable but incomplete',
    };
    const harness = createHarness((direction) =>
      direction === 'DEPARTURE'
        ? {
            status: 'PARTIAL',
            flights: [],
            fetchedAt: observedAt,
            sourceUpdatedAt: null,
            warnings: [warning],
            rowCount: 7,
          }
        : complete([arrival]),
    );

    const result = await harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.directions[0]).toMatchObject({
      status: 'PARTIAL',
      processedFlights: 0,
      errorCode: null,
    });
    expect(harness.applyStatusObservation).toHaveBeenCalledTimes(1);
  });

  it('applies status only to explicit persisted instances', async () => {
    const harness = createHarness();
    vi.mocked(
      harness.observationRepository.persistObservationBatch,
    ).mockImplementation(async ({ flights }) => {
      const instances: PersistedFlightObservation[] = flights
        .filter(({ direction }) => direction === 'ARRIVAL')
        .map((observation) => ({
          flightInstanceId: 'explicit-arrival',
          observation,
        }));
      return {
        processedInstances: flights.length,
        insertedSnapshots: flights.length,
        unchangedSnapshots: 0,
        persistedWarnings: 0,
        instances,
      };
    });

    await harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });

    expect(harness.applyStatusObservation).toHaveBeenCalledTimes(1);
    expect(harness.applyStatusObservation).toHaveBeenCalledWith(
      expect.objectContaining({ flightInstanceId: 'explicit-arrival' }),
    );
  });

  it('reloads full state and re-evaluates once after a stale transition', async () => {
    const harness = createHarness((direction) =>
      direction === 'DEPARTURE' ? complete([departure]) : complete([]),
    );
    const reloaded: FlightStatusState = {
      operationalStatus: 'CANCEL_PENDING',
      performanceStatus: 'DELAYED',
      delayMinutes: 20,
      scheduleVarianceMinutes: 20,
      cancelledObservedCount: 1,
      cancelConfirmedAt: new Date('2026-09-22T08:04:00.000Z'),
      lastStatusObservedAt: new Date('2026-09-22T08:04:30.000Z'),
    };
    vi.mocked(harness.syncRepository.getFlightStatusState)
      .mockResolvedValueOnce(initialState)
      .mockResolvedValueOnce(reloaded);
    vi.mocked(harness.applyStatusObservation)
      .mockRejectedValueOnce(
        new Error('Failed to record status transition', {
          cause: new Error('Stale status transition'),
        }),
      )
      .mockResolvedValueOnce({
        changed: true,
        decision: { ...reloaded, reason: 'CANCELLATION_CONFIRMED' },
      });

    const result = await harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });

    expect(result.status).toBe('SUCCESS');
    expect(harness.applyStatusObservation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ current: reloaded, observedAt }),
    );
  });

  it('fails a direction with STATUS_CONFLICT after a second stale result', async () => {
    const harness = createHarness((direction) =>
      direction === 'DEPARTURE' ? complete([departure]) : complete([]),
    );
    vi.mocked(harness.applyStatusObservation).mockRejectedValue(
      new Error('wrapper', { cause: new Error('Stale status transition') }),
    );

    const result = await harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.directions[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'STATUS_CONFLICT',
    });
    expect(harness.applyStatusObservation).toHaveBeenCalledTimes(2);
    expect(harness.lock.release).toHaveBeenCalledTimes(1);
  });

  it('waits for sibling work before releasing when one scrape run cannot start', async () => {
    const harness = createHarness();
    let resolveArrival!: (result: FlightSourceFetchResult) => void;
    vi.mocked(harness.syncRepository.startScrapeRun)
      .mockRejectedValueOnce(new Error('run insert failed'))
      .mockResolvedValueOnce({ id: 'arrival-run' });
    vi.mocked(harness.source.fetchFlights).mockImplementation(
      async () =>
        new Promise((resolve) => {
          resolveArrival = resolve;
        }),
    );
    const running = harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });
    await vi.waitFor(() =>
      expect(harness.source.fetchFlights).toHaveBeenCalledTimes(1),
    );
    expect(harness.lock.release).not.toHaveBeenCalled();
    resolveArrival(complete([arrival]));
    await expect(running).resolves.toMatchObject({ status: 'PARTIAL' });
    expect(harness.lock.release).toHaveBeenCalledTimes(1);
  });

  it('retains persisted counts when later status processing fails', async () => {
    const harness = createHarness((direction) =>
      direction === 'DEPARTURE' ? complete([departure]) : complete([]),
    );
    vi.mocked(harness.applyStatusObservation).mockRejectedValueOnce(
      new Error('status unavailable'),
    );
    const result = await harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });
    expect(result.directions[0]).toMatchObject({
      status: 'FAILED',
      processedFlights: 1,
    });
    expect(harness.syncRepository.completeScrapeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'run-1',
        status: 'FAILED',
        nxFlightCount: 1,
      }),
    );
  });

  it('renews the lease before persisting each usable direction', async () => {
    const harness = createHarness();
    await harness.service.run({ serviceDate: '2026-09-22', trigger: 'MANUAL' });
    expect(harness.lock.renew).toHaveBeenCalledWith({
      name: 'flight-sync',
      ownerId: 'sync-owner',
      now: observedAt,
      leaseMs: 90_000,
    });
    expect(harness.lock.renew).toHaveBeenCalledTimes(4);
  });

  it('awaits sibling work when failure finalization also rejects', async () => {
    const harness = createHarness();
    let resolveArrival!: (result: FlightSourceFetchResult) => void;
    vi.mocked(harness.source.fetchFlights).mockImplementation(
      async ({ directions }) => {
        if (directions[0] === 'DEPARTURE') throw new Error('source crashed');
        return new Promise((resolve) => {
          resolveArrival = resolve;
        });
      },
    );
    vi.mocked(harness.syncRepository.completeScrapeRun).mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const running = harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });
    await vi.waitFor(() =>
      expect(harness.source.fetchFlights).toHaveBeenCalledTimes(2),
    );
    expect(harness.lock.release).not.toHaveBeenCalled();
    resolveArrival(complete([arrival]));
    await expect(running).resolves.toMatchObject({ status: 'PARTIAL' });
    expect(harness.lock.release).toHaveBeenCalledTimes(1);
  });

  it('preserves direction context when failure finalization rejects', async () => {
    const harness = createHarness((direction) =>
      direction === 'DEPARTURE' ? complete([departure]) : complete([]),
    );
    vi.mocked(harness.applyStatusObservation).mockRejectedValueOnce(
      new Error('status unavailable'),
    );
    vi.mocked(harness.syncRepository.completeScrapeRun).mockImplementation(
      async (input) => {
        if (input.id === 'run-1' && input.status === 'FAILED') {
          throw new Error('database unavailable');
        }
      },
    );

    const result = await harness.service.run({
      serviceDate: '2026-09-22',
      trigger: 'MANUAL',
    });

    expect(result.directions[0]).toEqual({
      direction: 'DEPARTURE',
      scrapeRunId: 'run-1',
      status: 'FAILED',
      processedFlights: 1,
      errorCode: 'DIRECTION_FINALIZATION_FAILED',
    });
  });

  it('records raw source rows separately from persisted NX flights', async () => {
    const harness = createHarness((direction) => ({
      ...complete(direction === 'DEPARTURE' ? [departure] : [arrival]),
      rowCount: 9,
    }));
    await harness.service.run({ serviceDate: '2026-09-22', trigger: 'MANUAL' });
    expect(harness.syncRepository.completeScrapeRun).toHaveBeenCalledWith(
      expect.objectContaining({ rowCount: 9, nxFlightCount: 1 }),
    );
  });
});

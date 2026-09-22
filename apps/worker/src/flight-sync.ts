import type {
  FlightObservationRepository,
  FlightSyncRepository,
  JobLockRepository,
} from '@flightcheck/db';
import {
  applyFlightStatusObservation as applyDomainStatusObservation,
  type ApplyFlightStatusObservationInput,
  type StatusApplicationResult,
} from '@flightcheck/domain';
import type {
  FlightDirection,
  FlightSourceAdapter,
  FlightSourceWarning,
} from '@flightcheck/flight-source';

const LOCK_NAME = 'flight-sync';
const LEASE_MS = 90_000;
const DIRECTIONS = [
  { direction: 'DEPARTURE', source: 'DEPARTURES' },
  { direction: 'ARRIVAL', source: 'ARRIVALS' },
] as const;

export type FlightSyncOverallStatus =
  'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED_LOCKED';

export interface FlightSyncInput {
  serviceDate: string;
  trigger: 'SCHEDULED' | 'MANUAL' | 'STARTUP';
}

export interface DirectionSyncResult {
  direction: FlightDirection;
  scrapeRunId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  processedFlights: number;
  errorCode: string | null;
}

export interface FlightSyncResult {
  status: FlightSyncOverallStatus;
  correlationId: string;
  directions: DirectionSyncResult[];
}

export interface FlightSyncService {
  run(input: FlightSyncInput): Promise<FlightSyncResult>;
}

export interface FlightSyncServiceDependencies {
  lock: JobLockRepository;
  source: FlightSourceAdapter;
  syncRepository: FlightSyncRepository;
  observationRepository: FlightObservationRepository;
  applyStatusObservation?: (
    input: ApplyFlightStatusObservationInput,
  ) => Promise<StatusApplicationResult>;
  now: () => Date;
  createOwnerId: () => string;
}

class DirectionSyncError extends Error {
  constructor(
    readonly code: string,
    cause: unknown,
  ) {
    super(code, { cause });
    this.name = 'DirectionSyncError';
  }
}

function hasMessageInCauseChain(error: unknown, message: string): boolean {
  const visited = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !visited.has(current)) {
    if (current.message.includes(message)) return true;
    visited.add(current);
    current = current.cause;
  }
  return false;
}

function errorCode(error: unknown): string {
  if (error instanceof DirectionSyncError) return error.code;
  return 'PROCESSING_ERROR';
}

function overallStatus(
  directions: readonly DirectionSyncResult[],
): Exclude<FlightSyncOverallStatus, 'SKIPPED_LOCKED'> {
  const failedCount = directions.filter(
    ({ status }) => status === 'FAILED',
  ).length;
  if (failedCount === directions.length) return 'FAILED';
  if (
    failedCount > 0 ||
    directions.some(({ status }) => status === 'PARTIAL')
  ) {
    return 'PARTIAL';
  }
  return 'SUCCESS';
}

export function createFlightSyncService(
  dependencies: FlightSyncServiceDependencies,
): FlightSyncService {
  const applyStatusObservation =
    dependencies.applyStatusObservation ?? applyDomainStatusObservation;

  async function renewLease(ownerId: string): Promise<void> {
    const renewed = await dependencies.lock.renew({
      name: LOCK_NAME,
      ownerId,
      now: dependencies.now(),
      leaseMs: LEASE_MS,
    });
    if (!renewed)
      throw new DirectionSyncError(
        'LOCK_LOST',
        new Error('Lease ownership lost'),
      );
  }

  async function applyStatus(
    flightInstanceId: string,
    observation: ApplyFlightStatusObservationInput['observation'],
    observedAt: Date,
  ): Promise<void> {
    const firstState =
      await dependencies.syncRepository.getFlightStatusState(flightInstanceId);
    try {
      await applyStatusObservation({
        flightInstanceId,
        current: firstState,
        observation,
        observedAt,
        writer: dependencies.observationRepository,
      });
    } catch (cause) {
      if (!hasMessageInCauseChain(cause, 'Stale status transition'))
        throw cause;
      const reloadedState =
        await dependencies.syncRepository.getFlightStatusState(
          flightInstanceId,
        );
      try {
        await applyStatusObservation({
          flightInstanceId,
          current: reloadedState,
          observation,
          observedAt,
          writer: dependencies.observationRepository,
        });
      } catch (retryCause) {
        if (hasMessageInCauseChain(retryCause, 'Stale status transition')) {
          throw new DirectionSyncError('STATUS_CONFLICT', retryCause);
        }
        throw retryCause;
      }
    }
  }

  async function runDirection(
    configuration: (typeof DIRECTIONS)[number],
    input: FlightSyncInput,
    correlationId: string,
  ): Promise<DirectionSyncResult> {
    const startedAt = dependencies.now();
    let scrapeRunId: string;
    try {
      const started = await dependencies.syncRepository.startScrapeRun({
        source: configuration.source,
        correlationId,
        startedAt,
      });
      scrapeRunId = started.id;
    } catch {
      return {
        direction: configuration.direction,
        scrapeRunId: '',
        status: 'FAILED',
        processedFlights: 0,
        errorCode: 'SCRAPE_RUN_START_FAILED',
      };
    }
    let fetchedAt: Date | null = null;
    let sourceUpdatedAt: Date | null = null;
    let warnings: readonly FlightSourceWarning[] = [];
    let rowCount = 0;
    let processedFlights = 0;
    let completed = false;

    try {
      const sourceResult = await dependencies.source.fetchFlights({
        serviceDate: input.serviceDate,
        directions: [configuration.direction],
      });
      fetchedAt = sourceResult.fetchedAt;
      sourceUpdatedAt = sourceResult.sourceUpdatedAt;
      warnings = sourceResult.warnings;
      rowCount = sourceResult.rowCount;

      if (sourceResult.status === 'FAILED') {
        await dependencies.syncRepository.completeScrapeRun({
          id: scrapeRunId,
          status: 'FAILED',
          finishedAt: dependencies.now(),
          fetchedAt,
          sourceUpdatedAt,
          rowCount,
          nxFlightCount: 0,
          warningCount: warnings.length,
          warnings,
          errorCode: sourceResult.error.code,
        });
        completed = true;
        return {
          direction: configuration.direction,
          scrapeRunId,
          status: 'FAILED',
          processedFlights: 0,
          errorCode: sourceResult.error.code,
        };
      }

      await renewLease(correlationId);

      const persisted =
        await dependencies.observationRepository.persistObservationBatch({
          scrapeRunId,
          observedAt: sourceResult.fetchedAt,
          flights: sourceResult.flights,
          warnings: sourceResult.warnings,
        });
      processedFlights = persisted.processedInstances;
      for (const instance of persisted.instances) {
        await renewLease(correlationId);
        await applyStatus(
          instance.flightInstanceId,
          instance.observation,
          sourceResult.fetchedAt,
        );
      }

      const status =
        sourceResult.status === 'PARTIAL' || sourceResult.warnings.length > 0
          ? 'PARTIAL'
          : 'SUCCESS';
      await dependencies.syncRepository.completeScrapeRun({
        id: scrapeRunId,
        status,
        finishedAt: dependencies.now(),
        fetchedAt,
        sourceUpdatedAt,
        rowCount,
        nxFlightCount: persisted.processedInstances,
        warningCount: warnings.length,
        warnings,
        errorCode: null,
      });
      completed = true;
      return {
        direction: configuration.direction,
        scrapeRunId,
        status,
        processedFlights: persisted.processedInstances,
        errorCode: null,
      };
    } catch (cause) {
      const code = errorCode(cause);
      if (!completed) {
        try {
          await dependencies.syncRepository.completeScrapeRun({
            id: scrapeRunId,
            status: 'FAILED',
            finishedAt: dependencies.now(),
            fetchedAt,
            sourceUpdatedAt,
            rowCount,
            nxFlightCount: processedFlights,
            warningCount: warnings.length,
            warnings,
            errorCode: code,
          });
        } catch {
          return {
            direction: configuration.direction,
            scrapeRunId,
            status: 'FAILED',
            processedFlights,
            errorCode: 'DIRECTION_FINALIZATION_FAILED',
          };
        }
      }
      return {
        direction: configuration.direction,
        scrapeRunId,
        status: 'FAILED',
        processedFlights,
        errorCode: code,
      };
    }
  }

  return {
    async run(input) {
      const correlationId = dependencies.createOwnerId();
      const acquired = await dependencies.lock.acquire({
        name: LOCK_NAME,
        ownerId: correlationId,
        now: dependencies.now(),
        leaseMs: LEASE_MS,
      });
      if (!acquired) {
        return { status: 'SKIPPED_LOCKED', correlationId, directions: [] };
      }

      try {
        const settled = await Promise.allSettled(
          DIRECTIONS.map((configuration) =>
            runDirection(configuration, input, correlationId),
          ),
        );
        const directions = settled.map((result, index): DirectionSyncResult =>
          result.status === 'fulfilled'
            ? result.value
            : {
                direction: DIRECTIONS[index]!.direction,
                scrapeRunId: '',
                status: 'FAILED',
                processedFlights: 0,
                errorCode: 'DIRECTION_FINALIZATION_FAILED',
              },
        );
        return {
          status: overallStatus(directions),
          correlationId,
          directions,
        };
      } finally {
        await dependencies.lock.release({
          name: LOCK_NAME,
          ownerId: correlationId,
        });
      }
    },
  };
}

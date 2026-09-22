import {
  FlightSourceWarningSchema,
  NormalizedFlightSchema,
  type FlightSourceWarning,
  type NormalizedFlight,
} from '@flightcheck/flight-source';
/*
 * Runtime schemas deliberately live at this boundary: callers may be jobs,
 * scripts, or deserialized messages rather than type-checked TypeScript.
 */

import type {
  OperationalStatus,
  PerformanceStatus,
  PrismaClient,
} from './generated/prisma/client.js';
import { Prisma } from './generated/prisma/client.js';
import {
  buildCanonicalFlightSnapshot,
  hashCanonicalFlightSnapshot,
} from './flight-snapshot.js';

export interface PersistObservationBatchInput {
  scrapeRunId: string;
  observedAt: Date;
  flights: readonly NormalizedFlight[];
  warnings: readonly FlightSourceWarning[];
}

export interface PersistObservationBatchResult {
  processedInstances: number;
  insertedSnapshots: number;
  unchangedSnapshots: number;
  persistedWarnings: number;
  instances: PersistedFlightObservation[];
}

export interface PersistedFlightObservation {
  flightInstanceId: string;
  observation: NormalizedFlight;
}

export interface RecordStatusTransitionInput {
  flightInstanceId: string;
  expectedOperationalStatus: OperationalStatus;
  expectedPerformanceStatus: PerformanceStatus;
  expectedDelayMinutes: number | null;
  expectedScheduleVarianceMinutes: number | null;
  expectedCancelledObservedCount: number;
  expectedCancelConfirmedAt: Date | null;
  expectedLastStatusObservedAt: Date | null;
  operationalStatus: OperationalStatus;
  performanceStatus: PerformanceStatus;
  delayMinutes: number | null;
  scheduleVarianceMinutes: number | null;
  cancelledObservedCount: number;
  cancelConfirmedAt: Date | null;
  lastStatusObservedAt: Date;
  reason: string | null;
  observedAt: Date;
}

export interface StatusTransitionResult {
  changed: boolean;
}

export interface FlightObservationRepository {
  persistObservationBatch(
    input: PersistObservationBatchInput,
  ): Promise<PersistObservationBatchResult>;
  recordStatusTransition(
    input: RecordStatusTransitionInput,
  ): Promise<StatusTransitionResult>;
}

export class FlightPersistenceError extends Error {
  constructor(operation: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Failed to ${operation}${causeMessage}`, { cause });
    this.name = 'FlightPersistenceError';
  }
}

function serviceDateToUtc(serviceDate: string): Date {
  return new Date(`${serviceDate}T00:00:00.000Z`);
}

function datesEqual(left: Date | null, right: Date | null): boolean {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}

export function createFlightObservationRepository(
  prisma: PrismaClient,
): FlightObservationRepository {
  return {
    async persistObservationBatch(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          await transaction.scrapeRun.findUniqueOrThrow({
            where: { id: input.scrapeRunId },
            select: { id: true },
          });

          let insertedSnapshots = 0;
          const instances: PersistedFlightObservation[] = [];

          for (const candidate of input.flights) {
            const observation = NormalizedFlightSchema.parse(candidate);
            await transaction.flight.createMany({
              data: [{ flightNumber: observation.flightNumber }],
              skipDuplicates: true,
            });
            const flight = await transaction.flight.findUniqueOrThrow({
              where: { flightNumber: observation.flightNumber },
              select: { id: true },
            });
            const serviceDate = serviceDateToUtc(observation.serviceDate);
            const directionalSchedule =
              observation.direction === 'DEPARTURE'
                ? { scheduledDepartureAt: observation.scheduledAt }
                : { scheduledArrivalAt: observation.scheduledAt };
            const instance = await transaction.flightInstance.upsert({
              where: {
                flightId_serviceDate_direction_scheduledAt: {
                  flightId: flight.id,
                  serviceDate,
                  direction: observation.direction,
                  scheduledAt: observation.scheduledAt,
                },
              },
              create: {
                flightId: flight.id,
                serviceDate,
                direction: observation.direction,
                scheduledAt: observation.scheduledAt,
                ...directionalSchedule,
                estimatedAt: observation.estimatedAt,
                actualAt: observation.actualAt,
                originCode: observation.origin.code,
                destinationCode: observation.destination.code,
                lastObservedAt: input.observedAt,
              },
              update: {
                ...directionalSchedule,
                estimatedAt: observation.estimatedAt,
                actualAt: observation.actualAt,
                originCode: observation.origin.code,
                destinationCode: observation.destination.code,
                lastObservedAt: input.observedAt,
              },
              select: { id: true },
            });
            instances.push({
              flightInstanceId: instance.id,
              observation,
            });
            const payload = buildCanonicalFlightSnapshot(observation);
            const snapshot = await transaction.flightSnapshot.createMany({
              data: [
                {
                  flightInstanceId: instance.id,
                  scrapeRunId: input.scrapeRunId,
                  payloadHash: hashCanonicalFlightSnapshot(payload),
                  payload: payload as unknown as Prisma.InputJsonObject,
                  observedAt: input.observedAt,
                },
              ],
              skipDuplicates: true,
            });
            insertedSnapshots += snapshot.count;
          }

          const warnings = input.warnings.map((warning) =>
            FlightSourceWarningSchema.parse(warning),
          );

          await transaction.scrapeRun.update({
            where: { id: input.scrapeRunId },
            data: {
              warningCount: warnings.length,
              warnings: warnings as unknown as Prisma.InputJsonArray,
            },
          });

          return {
            processedInstances: input.flights.length,
            insertedSnapshots,
            unchangedSnapshots: input.flights.length - insertedSnapshots,
            persistedWarnings: warnings.length,
            instances,
          };
        });
      } catch (error) {
        throw new FlightPersistenceError('persist observation batch', error);
      }
    },
    async recordStatusTransition(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const selectStatus = {
            operationalStatus: true,
            performanceStatus: true,
            delayMinutes: true,
            scheduleVarianceMinutes: true,
            cancelledObservedCount: true,
            cancelConfirmedAt: true,
            lastStatusObservedAt: true,
          } as const;
          const current = await transaction.flightInstance.findUniqueOrThrow({
            where: { id: input.flightInstanceId },
            select: selectStatus,
          });
          const currentPolicyIsTarget =
            current.operationalStatus === input.operationalStatus &&
            current.performanceStatus === input.performanceStatus &&
            current.delayMinutes === input.delayMinutes &&
            current.scheduleVarianceMinutes === input.scheduleVarianceMinutes &&
            current.cancelledObservedCount === input.cancelledObservedCount &&
            datesEqual(current.cancelConfirmedAt, input.cancelConfirmedAt);
          const currentIsTarget =
            currentPolicyIsTarget &&
            datesEqual(
              current.lastStatusObservedAt,
              input.lastStatusObservedAt,
            );
          const currentIsExpected =
            current.operationalStatus === input.expectedOperationalStatus &&
            current.performanceStatus === input.expectedPerformanceStatus &&
            current.delayMinutes === input.expectedDelayMinutes &&
            current.scheduleVarianceMinutes ===
              input.expectedScheduleVarianceMinutes &&
            current.cancelledObservedCount ===
              input.expectedCancelledObservedCount &&
            datesEqual(
              current.cancelConfirmedAt,
              input.expectedCancelConfirmedAt,
            ) &&
            datesEqual(
              current.lastStatusObservedAt,
              input.expectedLastStatusObservedAt,
            );

          if (currentIsTarget) return { changed: false };
          if (!currentIsExpected) throw new Error('Stale status transition');

          if (currentPolicyIsTarget) {
            const watermarked = await transaction.flightInstance.updateMany({
              where: {
                id: input.flightInstanceId,
                operationalStatus: input.expectedOperationalStatus,
                performanceStatus: input.expectedPerformanceStatus,
                delayMinutes: input.expectedDelayMinutes,
                scheduleVarianceMinutes: input.expectedScheduleVarianceMinutes,
                cancelledObservedCount: input.expectedCancelledObservedCount,
                cancelConfirmedAt: input.expectedCancelConfirmedAt,
                lastStatusObservedAt: input.expectedLastStatusObservedAt,
              },
              data: { lastStatusObservedAt: input.lastStatusObservedAt },
            });
            if (watermarked.count === 1) return { changed: false };
            const winner = await transaction.flightInstance.findUniqueOrThrow({
              where: { id: input.flightInstanceId },
              select: selectStatus,
            });
            if (
              winner.operationalStatus === input.operationalStatus &&
              winner.performanceStatus === input.performanceStatus &&
              winner.delayMinutes === input.delayMinutes &&
              winner.scheduleVarianceMinutes ===
                input.scheduleVarianceMinutes &&
              winner.cancelledObservedCount === input.cancelledObservedCount &&
              datesEqual(winner.cancelConfirmedAt, input.cancelConfirmedAt) &&
              datesEqual(
                winner.lastStatusObservedAt,
                input.lastStatusObservedAt,
              )
            ) {
              return { changed: false };
            }
            throw new Error('Stale status transition');
          }

          const updated = await transaction.flightInstance.updateMany({
            where: {
              id: input.flightInstanceId,
              operationalStatus: input.expectedOperationalStatus,
              performanceStatus: input.expectedPerformanceStatus,
              delayMinutes: input.expectedDelayMinutes,
              scheduleVarianceMinutes: input.expectedScheduleVarianceMinutes,
              cancelledObservedCount: input.expectedCancelledObservedCount,
              cancelConfirmedAt: input.expectedCancelConfirmedAt,
              lastStatusObservedAt: input.expectedLastStatusObservedAt,
            },
            data: {
              operationalStatus: input.operationalStatus,
              performanceStatus: input.performanceStatus,
              delayMinutes: input.delayMinutes,
              scheduleVarianceMinutes: input.scheduleVarianceMinutes,
              cancelledObservedCount: input.cancelledObservedCount,
              cancelConfirmedAt: input.cancelConfirmedAt,
              lastStatusObservedAt: input.lastStatusObservedAt,
            },
          });

          if (updated.count === 0) {
            const winner = await transaction.flightInstance.findUniqueOrThrow({
              where: { id: input.flightInstanceId },
              select: selectStatus,
            });
            if (
              winner.operationalStatus === input.operationalStatus &&
              winner.performanceStatus === input.performanceStatus &&
              winner.delayMinutes === input.delayMinutes &&
              winner.scheduleVarianceMinutes ===
                input.scheduleVarianceMinutes &&
              winner.cancelledObservedCount === input.cancelledObservedCount &&
              datesEqual(winner.cancelConfirmedAt, input.cancelConfirmedAt) &&
              datesEqual(
                winner.lastStatusObservedAt,
                input.lastStatusObservedAt,
              )
            ) {
              return { changed: false };
            }
            throw new Error('Stale status transition');
          }

          await transaction.flightStatusHistory.create({
            data: {
              flightInstanceId: input.flightInstanceId,
              previousOperationalStatus: input.expectedOperationalStatus,
              previousPerformanceStatus: input.expectedPerformanceStatus,
              previousDelayMinutes: input.expectedDelayMinutes,
              previousScheduleVarianceMinutes:
                input.expectedScheduleVarianceMinutes,
              operationalStatus: input.operationalStatus,
              performanceStatus: input.performanceStatus,
              delayMinutes: input.delayMinutes,
              scheduleVarianceMinutes: input.scheduleVarianceMinutes,
              reason: input.reason,
              observedAt: input.observedAt,
            },
          });
          return { changed: true };
        });
      } catch (error) {
        throw new FlightPersistenceError('record status transition', error);
      }
    },
  };
}

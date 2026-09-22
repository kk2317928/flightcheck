import { createHash } from 'node:crypto';

import type { NormalizedFlight } from '@flightcheck/flight-source';

export interface CanonicalFlightSnapshot {
  flightNumber: string;
  serviceDate: string;
  direction: NormalizedFlight['direction'];
  scheduledAt: string;
  estimatedAt: string | null;
  actualAt: string | null;
  origin: { code: string | null; name: string };
  destination: { code: string | null; name: string };
  sourceStatus: NormalizedFlight['sourceStatus'];
  rawStatus: string;
}

export function buildCanonicalFlightSnapshot(
  flight: NormalizedFlight,
): CanonicalFlightSnapshot {
  return {
    flightNumber: flight.flightNumber,
    serviceDate: flight.serviceDate,
    direction: flight.direction,
    scheduledAt: flight.scheduledAt.toISOString(),
    estimatedAt: flight.estimatedAt?.toISOString() ?? null,
    actualAt: flight.actualAt?.toISOString() ?? null,
    origin: { code: flight.origin.code, name: flight.origin.name },
    destination: {
      code: flight.destination.code,
      name: flight.destination.name,
    },
    sourceStatus: flight.sourceStatus,
    rawStatus: flight.rawStatus,
  };
}

export function hashCanonicalFlightSnapshot(
  payload: CanonicalFlightSnapshot,
): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

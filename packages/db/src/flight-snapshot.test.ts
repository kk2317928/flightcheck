import { describe, expect, it } from 'vitest';

import {
  buildCanonicalFlightSnapshot,
  hashCanonicalFlightSnapshot,
} from './flight-snapshot.js';

const scheduledFlight = {
  flightNumber: 'NX001',
  serviceDate: '2026-09-22',
  direction: 'DEPARTURE' as const,
  scheduledAt: new Date('2026-09-22T08:00:00.000Z'),
  estimatedAt: null,
  actualAt: null,
  origin: { code: 'MFM', name: 'Macau' },
  destination: { code: 'TPE', name: 'Taipei' },
  sourceStatus: 'SCHEDULED' as const,
  rawStatus: 'Scheduled',
};

describe('canonical flight snapshots', () => {
  it('buildCanonicalFlightSnapshot preserves material fields in a stable shape', () => {
    expect(buildCanonicalFlightSnapshot(scheduledFlight)).toEqual({
      flightNumber: 'NX001',
      serviceDate: '2026-09-22',
      direction: 'DEPARTURE',
      scheduledAt: '2026-09-22T08:00:00.000Z',
      estimatedAt: null,
      actualAt: null,
      origin: { code: 'MFM', name: 'Macau' },
      destination: { code: 'TPE', name: 'Taipei' },
      sourceStatus: 'SCHEDULED',
      rawStatus: 'Scheduled',
    });
  });

  it('hashCanonicalFlightSnapshot is stable for replayed material data', () => {
    const first = buildCanonicalFlightSnapshot(scheduledFlight);
    const replay = buildCanonicalFlightSnapshot({ ...scheduledFlight });

    expect(hashCanonicalFlightSnapshot(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCanonicalFlightSnapshot(first)).toBe(
      hashCanonicalFlightSnapshot(replay),
    );
  });

  it.each([
    {
      name: 'estimated timestamp',
      flight: {
        ...scheduledFlight,
        estimatedAt: new Date('2026-09-22T08:20:00.000Z'),
      },
    },
    {
      name: 'airport name',
      flight: {
        ...scheduledFlight,
        destination: { code: 'TPE', name: 'Taiwan Taoyuan' },
      },
    },
    {
      name: 'source status',
      flight: {
        ...scheduledFlight,
        sourceStatus: 'DELAYED' as const,
      },
    },
    {
      name: 'raw status',
      flight: { ...scheduledFlight, rawStatus: 'Expected delay' },
    },
  ])(
    'hashCanonicalFlightSnapshot changes with a material $name change',
    ({ flight }) => {
      const baseline = hashCanonicalFlightSnapshot(
        buildCanonicalFlightSnapshot(scheduledFlight),
      );

      expect(
        hashCanonicalFlightSnapshot(buildCanonicalFlightSnapshot(flight)),
      ).not.toBe(baseline);
    },
  );
});

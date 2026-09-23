import { describe, expect, it } from 'vitest';

import { evaluateDataQuality } from './data-quality.js';
import type {
  DataQualityInput,
  DataQualitySourceEvidence,
} from './statistics-types.js';

const evaluatedAt = new Date('2026-09-22T15:30:00.000Z');
const cutoffAt = new Date('2026-09-22T15:30:00.000Z');

function evidence(
  ageMinutes: number,
  warningCount = 0,
  criticalWarningCount = 0,
): DataQualitySourceEvidence {
  return {
    lastSuccessfulAt: new Date(evaluatedAt.getTime() - ageMinutes * 60_000),
    warningCount,
    criticalWarningCount,
  };
}

function sourceState(
  overrides: Partial<DataQualityInput> = {},
): DataQualityInput {
  return {
    evaluatedAt,
    cutoffAt,
    maxAgeMinutes: 15,
    departures: evidence(5),
    arrivals: evidence(4),
    ...overrides,
  };
}

describe('evaluateDataQuality', () => {
  it.each([
    ['missing arrival', sourceState({ arrivals: null }), 'MISSING_ARRIVALS'],
    [
      'stale departure',
      sourceState({ departures: evidence(16) }),
      'STALE_DEPARTURES',
    ],
    [
      'critical warning',
      sourceState({ departures: evidence(5, 1, 1) }),
      'CRITICAL_WARNING',
    ],
  ])('marks %s as DEGRADED', (_name, input, reason) => {
    expect(evaluateDataQuality(input)).toEqual(
      expect.objectContaining({ quality: 'DEGRADED', reasons: [reason] }),
    );
  });

  it('reports every simultaneous monitoring gap in stable order', () => {
    expect(
      evaluateDataQuality(
        sourceState({ departures: null, arrivals: evidence(20, 2, 1) }),
      ),
    ).toMatchObject({
      quality: 'DEGRADED',
      reasons: ['MISSING_DEPARTURES', 'STALE_ARRIVALS', 'CRITICAL_WARNING'],
      warningSummary: { total: 2, critical: 1 },
    });
  });

  it('marks fresh complete direction evidence as COMPLETE', () => {
    expect(evaluateDataQuality(sourceState({}))).toEqual({
      quality: 'COMPLETE',
      reasons: [],
      lastSuccessfulAt: new Date('2026-09-22T15:25:00.000Z'),
      warningSummary: { total: 0, critical: 0 },
      evaluatedAt,
      cutoffAt,
    });
  });

  it('treats evidence exactly at the freshness limit as fresh', () => {
    expect(
      evaluateDataQuality(
        sourceState({ departures: evidence(15), arrivals: evidence(15) }),
      ).quality,
    ).toBe('COMPLETE');
  });
});

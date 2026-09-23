import type {
  DataQualityInput,
  DataQualityReason,
  DataQualityResult,
  DataQualitySourceEvidence,
} from './statistics-types.js';

function isStale(
  evidence: DataQualitySourceEvidence,
  input: DataQualityInput,
): boolean {
  return (
    input.evaluatedAt.getTime() - evidence.lastSuccessfulAt.getTime() >
    input.maxAgeMinutes * 60_000
  );
}

export function evaluateDataQuality(
  input: DataQualityInput,
): DataQualityResult {
  const reasons: DataQualityReason[] = [];

  if (input.departures === null) reasons.push('MISSING_DEPARTURES');
  if (input.arrivals === null) reasons.push('MISSING_ARRIVALS');
  if (input.departures !== null && isStale(input.departures, input)) {
    reasons.push('STALE_DEPARTURES');
  }
  if (input.arrivals !== null && isStale(input.arrivals, input)) {
    reasons.push('STALE_ARRIVALS');
  }

  const evidence = [input.departures, input.arrivals].filter(
    (value): value is DataQualitySourceEvidence => value !== null,
  );
  const warningTotal = evidence.reduce(
    (total, value) => total + value.warningCount,
    0,
  );
  const criticalTotal = evidence.reduce(
    (total, value) => total + value.criticalWarningCount,
    0,
  );
  if (criticalTotal > 0) reasons.push('CRITICAL_WARNING');

  return {
    quality: reasons.length === 0 ? 'COMPLETE' : 'DEGRADED',
    reasons,
    lastSuccessfulAt:
      evidence.length === 0
        ? null
        : new Date(
            Math.min(
              ...evidence.map((value) => value.lastSuccessfulAt.getTime()),
            ),
          ),
    warningSummary: { total: warningTotal, critical: criticalTotal },
    evaluatedAt: input.evaluatedAt,
    cutoffAt: input.cutoffAt,
  };
}

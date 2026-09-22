import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const schemaPath = fileURLToPath(
  new URL('../prisma/schema.prisma', import.meta.url),
);

describe('Prisma schema contract', () => {
  it('contains every P0 model', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const models = [
      'AdminUser',
      'AdminSession',
      'AdminAuditLog',
      'Flight',
      'FlightInstance',
      'FlightSnapshot',
      'FlightStatusHistory',
      'DailyStatistic',
      'ScrapeRun',
      'SocialTemplate',
      'SocialEvent',
      'SocialEventFlight',
      'SocialPost',
      'Setting',
      'JobLock',
    ];

    for (const model of models) {
      expect(schema).toContain(`model ${model} {`);
    }
  });

  it('declares the required database idempotency constraints', () => {
    const schema = readFileSync(schemaPath, 'utf8');

    expect(schema).toMatch(/idempotencyKey\s+String\s+@unique/);
    expect(schema).toContain('@@unique([socialEventId, platform]');
    expect(schema).toContain('@@unique([flightInstanceId, payloadHash]');
    expect(schema).toContain(
      '@@unique([flightId, serviceDate, direction, scheduledAt]',
    );
    expect(schema).toMatch(/model JobLock \{[\s\S]*name\s+String\s+@id/);
  });

  it('retains previous values for each recorded status transition', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const historyModel = schema.match(
      /model FlightStatusHistory \{[\s\S]*?\n\}/,
    )?.[0];

    expect(historyModel).toMatch(
      /previousOperationalStatus\s+OperationalStatus\?/,
    );
    expect(historyModel).toMatch(
      /previousPerformanceStatus\s+PerformanceStatus\?/,
    );
    expect(historyModel).toMatch(/previousDelayMinutes\s+Int\?/);
    expect(historyModel).toMatch(/previousScheduleVarianceMinutes\s+Int\?/);
    expect(historyModel).toMatch(/scheduleVarianceMinutes\s+Int\?/);
  });

  it('stores signed schedule variance on each flight instance', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const instanceModel = schema.match(
      /model FlightInstance \{[\s\S]*?\n\}/,
    )?.[0];

    expect(instanceModel).toMatch(/scheduleVarianceMinutes\s+Int\?/);
    expect(instanceModel).toMatch(/lastStatusObservedAt\s+DateTime\?/);
  });
});

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
});

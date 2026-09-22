import { describe, expect, it } from 'vitest';

import { MacauAirportFlightSource } from './macau-airport-adapter.js';
import type { MacauAirportBoardClient } from './macau-airport-client.js';

const now = new Date('2026-09-22T10:11:00.000Z');

describe('MacauAirportFlightSource', () => {
  it('never converts an HTTP failure into a successful empty observation', async () => {
    const client: MacauAirportBoardClient = {
      fetchBoards: () =>
        Promise.resolve({
          status: 'FAILED',
          documents: [],
          errors: [
            {
              direction: 'DEPARTURE',
              attempts: 3,
              code: 'TIMEOUT',
              message: 'timed out',
              retryable: true,
            },
          ],
        }),
    };

    const result = await new MacauAirportFlightSource(
      client,
      () => now,
    ).fetchFlights({
      serviceDate: '2026-09-22',
      directions: ['DEPARTURE'],
    });

    expect(result).toEqual({
      status: 'FAILED',
      flights: [],
      warnings: [],
      fetchedAt: now,
      sourceUpdatedAt: null,
      error: { code: 'TIMEOUT', message: 'timed out', retryable: true },
    });
  });

  it('marks parsed warnings and a missing direction as partial', async () => {
    const html = `<table id="flights-datatable"><tbody><tr class="detail" data-flight-date="2026-09-22" data-is-departure="1"><td>10:00</td><td>Air Macau</td><td>Unknown Place</td><td>NX100</td><td>2</td><td>Scheduled</td></tr></tbody></table>`;
    const client: MacauAirportBoardClient = {
      fetchBoards: () =>
        Promise.resolve({
          status: 'PARTIAL',
          documents: [
            {
              direction: 'DEPARTURE',
              html,
              fetchedAt: now,
              sourceUpdatedAt: null,
            },
          ],
          errors: [
            {
              direction: 'ARRIVAL',
              attempts: 1,
              code: 'HTTP_ERROR',
              message: 'upstream failed',
              retryable: true,
            },
          ],
        }),
    };

    const result = await new MacauAirportFlightSource(
      client,
      () => now,
    ).fetchFlights({
      serviceDate: '2026-09-22',
      directions: ['DEPARTURE', 'ARRIVAL'],
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.flights).toHaveLength(1);
    expect(result.warnings.map(({ code }) => code)).toEqual([
      'UNKNOWN_AIRPORT',
      'SOURCE_PARTIAL',
    ]);
  });

  it('marks a request partial when the board does not cover its service date', async () => {
    const html = `<table id="flights-datatable"><tbody><tr class="detail" data-flight-date="2026-09-21" data-is-departure="1"><td>10:00</td><td>Air Macau</td><td>Beijing</td><td>NX100</td><td>2</td><td>Scheduled</td></tr></tbody></table>`;
    const client: MacauAirportBoardClient = {
      fetchBoards: () =>
        Promise.resolve({
          status: 'COMPLETE',
          documents: [
            {
              direction: 'DEPARTURE',
              html,
              fetchedAt: now,
              sourceUpdatedAt: null,
            },
          ],
          errors: [],
        }),
    };

    const result = await new MacauAirportFlightSource(
      client,
      () => now,
    ).fetchFlights({
      serviceDate: '2026-09-22',
      directions: ['DEPARTURE'],
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.flights).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('SOURCE_PARTIAL');
    expect(result.warnings[0]?.details?.serviceDate).toBe('2026-09-22');
  });
});

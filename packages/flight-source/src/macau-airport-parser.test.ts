import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseMacauAirportDocument } from './macau-airport-parser.js';
import type { MacauAirportDocument } from './macau-airport-client.js';

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL(`../fixtures/macau-airport/${name}.html`, import.meta.url),
    ),
    'utf8',
  );

const document = (
  html: string,
  direction: MacauAirportDocument['direction'] = 'DEPARTURE',
): MacauAirportDocument => ({
  direction,
  html,
  fetchedAt: new Date('2026-09-22T10:11:00.000Z'),
  sourceUpdatedAt: new Date('2026-09-22T10:09:01.000Z'),
});

function board(rows: string, direction: 'DEPARTURE' | 'ARRIVAL' = 'DEPARTURE') {
  const airportHeading = direction === 'DEPARTURE' ? 'Destination' : 'Origin';
  return `<table id="flights-datatable"><thead><tr><td>Time</td><td>Airline</td><td>${airportHeading}</td><td>Flight N°</td><td>Status</td></tr></thead><tbody>${rows}</tbody></table>`;
}

function row({
  date = '2026-09-22',
  time = '23:55',
  airport = 'Tokyo-Narita',
  flight = 'NX862D',
  status = 'Scheduled',
  direction = 'DEPARTURE',
}: Partial<{
  date: string;
  time: string;
  airport: string;
  flight: string;
  status: string;
  direction: 'DEPARTURE' | 'ARRIVAL';
}> = {}) {
  const marker = direction === 'DEPARTURE' ? '1' : '';
  const gate = direction === 'DEPARTURE' ? '<td>8</td>' : '';
  return `<tr class="detail" data-flight-date="${date}" data-is-departure="${marker}"><td>${time}</td><td>Air Macau</td><td>${airport}</td><td>${flight}</td>${gate}<td>${status}</td><td><table class="details-table"><tr><td>mobile duplicate</td></tr></table></td></tr>`;
}

describe('parseMacauAirportDocument', () => {
  it('parses departure fixtures into UTC flights and actual take-off times', () => {
    const result = parseMacauAirportDocument(document(fixture('departures')));

    expect(result.warnings).toEqual([]);
    expect(result.flights).toHaveLength(2);
    expect(result.flights[0]).toMatchObject({
      flightNumber: 'NX006',
      serviceDate: '2026-09-22',
      direction: 'DEPARTURE',
      scheduledAt: new Date('2026-09-22T03:55:00.000Z'),
      actualAt: new Date('2026-09-22T04:15:00.000Z'),
      sourceStatus: 'DEPARTED',
      origin: { code: 'MFM', name: 'Macau' },
      destination: { code: 'PEK', name: 'Beijing' },
    });
  });

  it('filters non-NX arrivals and preserves a suffixed delayed flight', () => {
    const result = parseMacauAirportDocument(
      document(fixture('arrivals'), 'ARRIVAL'),
    );

    expect(result.flights).toEqual([
      expect.objectContaining({
        flightNumber: 'NX861D',
        serviceDate: '2026-09-21',
        sourceStatus: 'DELAYED',
        scheduledAt: new Date('2026-09-21T12:05:00.000Z'),
        estimatedAt: new Date('2026-09-22T11:50:00.000Z'),
        origin: { code: 'NRT', name: 'Tokyo-Narita' },
        destination: { code: 'MFM', name: 'Macau' },
      }),
    ]);
  });

  it.each([
    ['Cancelled', 'CANCELLED'],
    ['Diverted', 'DIVERTED'],
  ] as const)('normalizes %s status', (status, expected) => {
    const result = parseMacauAirportDocument(document(board(row({ status }))));

    expect(result.flights[0]?.sourceStatus).toBe(expected);
  });

  it('resolves operational times across Macau midnight', () => {
    const result = parseMacauAirportDocument(
      document(board(row({ status: 'TOOK OFF AT 00:15' }))),
    );

    expect(result.flights[0]?.actualAt).toEqual(
      new Date('2026-09-22T16:15:00.000Z'),
    );
  });

  it('warns instead of guessing when an operational time has two equal dates', () => {
    const result = parseMacauAirportDocument(
      document(board(row({ time: '12:00', status: 'TOOK OFF AT 00:00' }))),
    );

    expect(result.flights[0]).toMatchObject({
      sourceStatus: 'DEPARTED',
      actualAt: null,
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'AMBIGUOUS_TIME',
        flightNumber: 'NX862D',
      }),
    ]);
  });

  it('keeps unknown airport and status text without guessing', () => {
    const result = parseMacauAirportDocument(
      document(
        board(row({ airport: 'Mystery Port', status: 'Boarding Soon' })),
      ),
    );

    expect(result.flights[0]).toMatchObject({
      destination: { code: null, name: 'Mystery Port' },
      sourceStatus: 'UNKNOWN',
      rawStatus: 'Boarding Soon',
    });
    expect(result.warnings.map(({ code }) => code)).toEqual([
      'UNKNOWN_AIRPORT',
      'UNKNOWN_STATUS',
    ]);
  });

  it('warns and skips malformed rows', () => {
    const malformed = row({ flight: '', time: 'later' });
    const result = parseMacauAirportDocument(document(board(malformed)));

    expect(result.flights).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'MALFORMED_ROW', rowIndex: 0 }),
    ]);
  });

  it('does not invent scheduled status when the status cell is missing', () => {
    const missingStatus = `<tr class="detail" data-flight-date="2026-09-22" data-is-departure="1"><td>10:00</td><td>Air Macau</td><td>Beijing</td><td>NX100</td><td>2</td></tr>`;
    const result = parseMacauAirportDocument(document(board(missingStatus)));

    expect(result.flights).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'MALFORMED_ROW', rowIndex: 0 }),
    ]);
  });

  it('reports selector drift instead of a complete empty parse', () => {
    const changedRow = row().replace('class="detail"', 'class="flight-row"');
    const result = parseMacauAirportDocument(document(board(changedRow)));

    expect(result.flights).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'MALFORMED_ROW' }),
    ]);
  });

  it('deduplicates the same service flight and emits a warning', () => {
    const duplicate = row();
    const result = parseMacauAirportDocument(
      document(board(`${duplicate}${duplicate}`)),
    );

    expect(result.flights).toHaveLength(1);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'DUPLICATE_ROW',
        rowIndex: 1,
        flightNumber: 'NX862D',
      }),
    ]);
  });

  it('suppresses conflicting duplicate observations instead of picking one', () => {
    const cancelled = row({ status: 'Cancelled' });
    const departed = row({ status: 'TOOK OFF AT 00:15' });
    const result = parseMacauAirportDocument(
      document(board(`${cancelled}${departed}`)),
    );

    expect(result.flights).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'DUPLICATE_ROW',
        flightNumber: 'NX862D',
      }),
    ]);
  });

  it('turns normalized schema violations into malformed-row warnings', () => {
    const result = parseMacauAirportDocument(
      document(board(row({ flight: 'NX123456789012345' }))),
    );

    expect(result.flights).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'MALFORMED_ROW', rowIndex: 0 }),
    ]);
  });

  it('treats object prototype names as unknown airports', () => {
    const result = parseMacauAirportDocument(
      document(board(row({ airport: '__proto__' }))),
    );

    expect(result.flights[0]?.destination).toEqual({
      code: null,
      name: '__proto__',
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_AIRPORT' }),
    ]);
  });
});

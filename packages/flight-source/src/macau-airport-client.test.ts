import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  MacauAirportHttpClient,
  type MacauAirportHttpClientOptions,
} from './macau-airport-client.js';

const fixedNow = new Date('2026-09-22T10:11:00.000Z');
const boardHtml = (
  updatedAt: string,
  direction: 'DEPARTURE' | 'ARRIVAL' = 'DEPARTURE',
) => `<!doctype html>
<html><body>
<div>Last updated on: ${updatedAt}</div>
<table id="flights-datatable"><thead><tr><td>${direction === 'DEPARTURE' ? 'Destination' : 'Origin'}</td></tr></thead><tbody></tbody></table>
</body></html>`;

function response(
  body: string,
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=UTF-8' },
    ...init,
  });
}

function client(
  fetchImplementation: typeof fetch,
  options: Partial<MacauAirportHttpClientOptions> = {},
) {
  return new MacauAirportHttpClient({
    fetch: fetchImplementation,
    now: () => fixedNow,
    sleep: () => Promise.resolve(),
    timeoutMs: 20,
    maxAttempts: 3,
    ...options,
  });
}

describe('MacauAirportHttpClient', () => {
  it('fetches official departure and arrival boards with source timestamps', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(boardHtml('22/09/2026 18:09:01')))
      .mockResolvedValueOnce(
        response(boardHtml('22/09/2026 18:10:01', 'ARRIVAL')),
      );

    const result = await client(fetchMock).fetchBoards([
      'DEPARTURE',
      'ARRIVAL',
    ]);

    expect(result.status).toBe('COMPLETE');
    expect(result.documents).toEqual([
      expect.objectContaining({
        direction: 'DEPARTURE',
        fetchedAt: fixedNow,
        sourceUpdatedAt: new Date('2026-09-22T10:09:01.000Z'),
      }),
      expect.objectContaining({
        direction: 'ARRIVAL',
        fetchedAt: fixedNow,
        sourceUpdatedAt: new Date('2026-09-22T10:10:01.000Z'),
      }),
    ]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://www.macau-airport.com/en/flights/real-time/departures',
      'https://www.macau-airport.com/en/flights/real-time/arrivals',
    ]);
  });

  it('retries a transient HTTP response up to the configured cap', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('busy', { status: 503 }))
      .mockResolvedValueOnce(response('busy', { status: 503 }))
      .mockResolvedValueOnce(response(boardHtml('22/09/2026 18:09:01')));

    const result = await client(fetchMock).fetchBoards(['DEPARTURE']);

    expect(result.status).toBe('COMPLETE');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('aborts timed-out attempts and returns failure instead of an empty board', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });

    const result = await client(fetchMock, { timeoutMs: 1 }).fetchBoards([
      'DEPARTURE',
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      status: 'FAILED',
      documents: [],
      errors: [
        {
          direction: 'DEPARTURE',
          attempts: 3,
          code: 'TIMEOUT',
          retryable: true,
        },
      ],
    });
  });

  it('does not retry a non-retryable HTTP response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response('not found', { status: 404 }));

    const result = await client(fetchMock).fetchBoards(['ARRIVAL']);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'FAILED',
      documents: [],
      errors: [{ code: 'HTTP_ERROR', retryable: false, attempts: 1 }],
    });
  });

  it('returns partial when one direction fails without discarding usable HTML', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(boardHtml('22/09/2026 18:09:01')))
      .mockResolvedValue(response('busy', { status: 503 }));

    const result = await client(fetchMock, { maxAttempts: 2 }).fetchBoards([
      'DEPARTURE',
      'ARRIVAL',
    ]);

    expect(result).toMatchObject({
      status: 'PARTIAL',
      documents: [{ direction: 'DEPARTURE' }],
      errors: [{ direction: 'ARRIVAL', attempts: 2 }],
    });
  });

  it('rejects a successful HTTP response that is not a flight board', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response('<html><body>maintenance</body></html>'));

    const result = await client(fetchMock).fetchBoards(['DEPARTURE']);

    expect(result).toMatchObject({
      status: 'FAILED',
      documents: [],
      errors: [{ code: 'MALFORMED_RESPONSE', retryable: false, attempts: 1 }],
    });
  });

  it('rejects a board whose content belongs to the other direction', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(boardHtml('22/09/2026 18:10:01', 'ARRIVAL')));

    const result = await client(fetchMock).fetchBoards(['DEPARTURE']);

    expect(result).toMatchObject({
      status: 'FAILED',
      documents: [],
      errors: [{ code: 'MALFORMED_RESPONSE', attempts: 1 }],
    });
  });

  it('does not normalize an impossible source update timestamp', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(boardHtml('31/02/2026 25:61:61')));

    const result = await client(fetchMock).fetchBoards(['DEPARTURE']);

    expect(result.documents[0]?.sourceUpdatedAt).toBeNull();
  });
});

describe('Macau Airport fixtures', () => {
  const fixture = (name: string) =>
    readFileSync(
      fileURLToPath(
        new URL(`../fixtures/macau-airport/${name}.html`, import.meta.url),
      ),
      'utf8',
    );

  it.each([
    ['departures', 'data-is-departure="1"', 'NX006'],
    ['arrivals', 'data-is-departure=""', 'NX861D'],
  ])(
    'keeps a sanitized representative %s board',
    (name, directionMarker, flightNumber) => {
      const html = fixture(name);

      expect(html).toContain('id="flights-datatable"');
      expect(html).toContain(directionMarker);
      expect(html).toContain(flightNumber);
      expect(html).toContain('details-table');
      expect(html).not.toMatch(/cookie|set-cookie|csrf|session|analytics/i);
      expect(html).not.toMatch(/https?:\/\//i);
    },
  );
});

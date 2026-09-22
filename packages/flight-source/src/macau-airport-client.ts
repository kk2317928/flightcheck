import type { FlightDirection, FlightSourceFailure } from './contracts.js';

export const MACAU_AIRPORT_BOARD_URLS = {
  DEPARTURE: 'https://www.macau-airport.com/en/flights/real-time/departures',
  ARRIVAL: 'https://www.macau-airport.com/en/flights/real-time/arrivals',
} as const satisfies Record<FlightDirection, string>;

export interface MacauAirportDocument {
  direction: FlightDirection;
  html: string;
  fetchedAt: Date;
  sourceUpdatedAt: Date | null;
}

export interface MacauAirportFetchError extends FlightSourceFailure {
  direction: FlightDirection;
  attempts: number;
}

export type MacauAirportBoardResult =
  | {
      status: 'COMPLETE';
      documents: MacauAirportDocument[];
      errors: [];
    }
  | {
      status: 'PARTIAL';
      documents: MacauAirportDocument[];
      errors: MacauAirportFetchError[];
    }
  | {
      status: 'FAILED';
      documents: [];
      errors: MacauAirportFetchError[];
    };

export interface MacauAirportHttpClientOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface MacauAirportBoardClient {
  fetchBoards(directions: FlightDirection[]): Promise<MacauAirportBoardResult>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;
const USER_AGENT =
  'FlightCheck/0.1 (+https://github.com/kk2317928/flightcheck)';

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function parseMacauTimestamp(html: string): Date | null {
  const match = html.match(
    /Last\s+updated\s+on:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/i,
  );
  if (!match) return null;

  const [, day, month, year, hour, minute, second] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  if (parts.some(Number.isNaN)) return null;

  const [
    numericYear,
    numericMonth,
    numericDay,
    numericHour,
    numericMinute,
    numericSecond,
  ] = parts as [number, number, number, number, number, number];
  const parsed = new Date(
    Date.UTC(
      numericYear,
      numericMonth - 1,
      numericDay,
      numericHour - 8,
      numericMinute,
      numericSecond,
    ),
  );
  const macauWallClock = new Date(parsed.getTime() + 8 * 60 * 60 * 1_000);
  const isExact =
    macauWallClock.getUTCFullYear() === numericYear &&
    macauWallClock.getUTCMonth() === numericMonth - 1 &&
    macauWallClock.getUTCDate() === numericDay &&
    macauWallClock.getUTCHours() === numericHour &&
    macauWallClock.getUTCMinutes() === numericMinute &&
    macauWallClock.getUTCSeconds() === numericSecond;

  return isExact ? parsed : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function matchesDirection(html: string, direction: FlightDirection): boolean {
  if (direction === 'DEPARTURE') {
    return (
      /data-is-departure=["']1["']/i.test(html) ||
      /<td[^>]*>\s*Destination\s*<\/td>/i.test(html)
    );
  }

  return (
    /data-is-departure=["']\s*["']/i.test(html) ||
    /<td[^>]*>\s*Origin\s*<\/td>/i.test(html)
  );
}

export class MacauAirportHttpClient implements MacauAirportBoardClient {
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: number;

  constructor(options: MacauAirportHttpClientOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? defaultSleep;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    if (this.#timeoutMs <= 0 || this.#maxAttempts < 1) {
      throw new RangeError('timeoutMs and maxAttempts must be positive.');
    }
  }

  async fetchBoards(
    directions: FlightDirection[],
  ): Promise<MacauAirportBoardResult> {
    if (directions.length === 0) {
      throw new RangeError('At least one direction is required.');
    }

    const uniqueDirections = [...new Set(directions)];
    const outcomes = await Promise.all(
      uniqueDirections.map((direction) => this.#fetchBoard(direction)),
    );
    const documents = outcomes.flatMap((outcome) =>
      'document' in outcome ? [outcome.document] : [],
    );
    const errors = outcomes.flatMap((outcome) =>
      'error' in outcome ? [outcome.error] : [],
    );

    if (documents.length === 0) {
      return { status: 'FAILED', documents: [], errors };
    }
    if (errors.length > 0) {
      return { status: 'PARTIAL', documents, errors };
    }
    return { status: 'COMPLETE', documents, errors: [] };
  }

  async #fetchBoard(
    direction: FlightDirection,
  ): Promise<
    { document: MacauAirportDocument } | { error: MacauAirportFetchError }
  > {
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);

      try {
        const response = await this.#fetch(
          MACAU_AIRPORT_BOARD_URLS[direction],
          {
            headers: {
              accept: 'text/html,application/xhtml+xml',
              'user-agent': USER_AGENT,
            },
            redirect: 'follow',
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const retryable = isRetryableStatus(response.status);
          if (retryable && attempt < this.#maxAttempts) {
            await this.#waitBeforeRetry(attempt);
            continue;
          }
          return {
            error: {
              direction,
              attempts: attempt,
              code: 'HTTP_ERROR',
              message: `Macau Airport returned HTTP ${response.status}.`,
              retryable,
            },
          };
        }

        const contentType = response.headers.get('content-type') ?? '';
        const html = await response.text();
        if (
          !contentType.toLowerCase().includes('text/html') ||
          !/id=["']flights-datatable["']/i.test(html) ||
          !matchesDirection(html, direction)
        ) {
          return {
            error: {
              direction,
              attempts: attempt,
              code: 'MALFORMED_RESPONSE',
              message: 'Macau Airport response did not contain a flight board.',
              retryable: false,
            },
          };
        }

        return {
          document: {
            direction,
            html,
            fetchedAt: this.#now(),
            sourceUpdatedAt: parseMacauTimestamp(html),
          },
        };
      } catch (error) {
        const timedOut = controller.signal.aborted;
        if (attempt < this.#maxAttempts) {
          await this.#waitBeforeRetry(attempt);
          continue;
        }
        return {
          error: {
            direction,
            attempts: attempt,
            code: timedOut ? 'TIMEOUT' : 'HTTP_ERROR',
            message: timedOut
              ? 'Macau Airport request timed out.'
              : `Macau Airport request failed: ${error instanceof Error ? error.message : 'unknown network error'}.`,
            retryable: true,
          },
        };
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error('Unreachable retry state.');
  }

  async #waitBeforeRetry(attempt: number): Promise<void> {
    await this.#sleep(this.#retryDelayMs * 2 ** (attempt - 1));
  }
}

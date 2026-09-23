import { load } from 'cheerio';

import { NormalizedFlightSchema } from './contracts.js';
import type {
  FlightSourceWarning,
  NormalizedFlight,
  SourceFlightStatus,
} from './contracts.js';
import { MACAU_AIRPORT, resolveAirport } from './airport-dictionary.js';
import type { MacauAirportDocument } from './macau-airport-client.js';

export interface MacauAirportParseResult {
  flights: NormalizedFlight[];
  warnings: FlightSourceWarning[];
  serviceDates: string[];
  rowCount: number;
}

interface ParsedStatus {
  status: SourceFlightStatus;
  estimatedAt: Date | null;
  actualAt: Date | null;
  warning?: FlightSourceWarning;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function macauInstant(serviceDate: string, time: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const instant = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  const local = new Date(instant.getTime() + 8 * 60 * 60 * 1_000);
  const exact =
    local.getUTCFullYear() === year &&
    local.getUTCMonth() === month - 1 &&
    local.getUTCDate() === day &&
    local.getUTCHours() === hour &&
    local.getUTCMinutes() === minute;

  return exact ? instant : null;
}

function resolveOperationalTime(
  time: string,
  scheduledAt: Date,
  rowIndex: number,
  flightNumber: string,
  notBeforeScheduled = false,
): { instant: Date | null; warning?: FlightSourceWarning } {
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!timeMatch) {
    return {
      instant: null,
      warning: {
        code: 'AMBIGUOUS_TIME',
        message: `Could not resolve operational time ${time}.`,
        rowIndex,
        flightNumber,
      },
    };
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) {
    return {
      instant: null,
      warning: {
        code: 'AMBIGUOUS_TIME',
        message: `Could not resolve operational time ${time}.`,
        rowIndex,
        flightNumber,
      },
    };
  }

  const scheduledLocal = new Date(scheduledAt.getTime() + 8 * 60 * 60 * 1_000);
  const base = Date.UTC(
    scheduledLocal.getUTCFullYear(),
    scheduledLocal.getUTCMonth(),
    scheduledLocal.getUTCDate(),
    hour - 8,
    minute,
  );
  const day = 24 * 60 * 60 * 1_000;
  const candidates = [base - day, base, base + day]
    .filter(
      (timestamp) => !notBeforeScheduled || timestamp >= scheduledAt.getTime(),
    )
    .map((timestamp) => ({
      timestamp,
      distance: Math.abs(timestamp - scheduledAt.getTime()),
    }))
    .sort((left, right) => left.distance - right.distance);

  if (candidates[0]?.distance === candidates[1]?.distance) {
    return {
      instant: null,
      warning: {
        code: 'AMBIGUOUS_TIME',
        message: `Operational time ${time} is equally close to two dates.`,
        rowIndex,
        flightNumber,
      },
    };
  }

  return { instant: new Date(candidates[0]!.timestamp) };
}

function parseStatus(
  rawStatus: string,
  scheduledAt: Date,
  rowIndex: number,
  flightNumber: string,
): ParsedStatus {
  const status = cleanText(rawStatus);
  if (/^cancelled$/i.test(status)) {
    return { status: 'CANCELLED', estimatedAt: null, actualAt: null };
  }
  if (/^diverted$/i.test(status)) {
    return { status: 'DIVERTED', estimatedAt: null, actualAt: null };
  }

  const delay = /^delay(?:ed)? until\s+(\d{2}:\d{2})$/i.exec(status);
  if (delay) {
    const resolved = resolveOperationalTime(
      delay[1]!,
      scheduledAt,
      rowIndex,
      flightNumber,
      true,
    );
    return {
      status: 'DELAYED',
      estimatedAt: resolved.instant,
      actualAt: null,
      warning: resolved.warning,
    };
  }

  const completed = /^(?:took off|landed|arrived) at\s+(\d{2}:\d{2})$/i.exec(
    status,
  );
  if (completed) {
    const resolved = resolveOperationalTime(
      completed[1]!,
      scheduledAt,
      rowIndex,
      flightNumber,
    );
    return {
      status: /^took off/i.test(status) ? 'DEPARTED' : 'ARRIVED',
      estimatedAt: null,
      actualAt: resolved.instant,
      warning: resolved.warning,
    };
  }

  if (/^arrived$/i.test(status)) {
    return { status: 'ARRIVED', estimatedAt: null, actualAt: null };
  }
  if (/^(?:scheduled|on time)$/i.test(status)) {
    return { status: 'SCHEDULED', estimatedAt: null, actualAt: null };
  }

  return {
    status: 'UNKNOWN',
    estimatedAt: null,
    actualAt: null,
    warning: {
      code: 'UNKNOWN_STATUS',
      message: `Unknown Macau Airport status: ${status}.`,
      rowIndex,
      flightNumber,
      details: { rawStatus: status },
    },
  };
}

function flightKey(flight: NormalizedFlight): string {
  return `${flight.serviceDate}:${flight.direction}:${flight.flightNumber}`;
}

function sameObservation(
  left: NormalizedFlight,
  right: NormalizedFlight,
): boolean {
  return (
    left.scheduledAt.getTime() === right.scheduledAt.getTime() &&
    left.estimatedAt?.getTime() === right.estimatedAt?.getTime() &&
    left.actualAt?.getTime() === right.actualAt?.getTime() &&
    left.sourceStatus === right.sourceStatus &&
    left.rawStatus === right.rawStatus &&
    left.origin.code === right.origin.code &&
    left.destination.code === right.destination.code
  );
}

export function parseMacauAirportDocument(
  document: MacauAirportDocument,
  requestedServiceDate?: string,
): MacauAirportParseResult {
  const $ = load(document.html);
  const flights: NormalizedFlight[] = [];
  const warnings: FlightSourceWarning[] = [];
  const seen = new Map<string, NormalizedFlight>();
  const conflicted = new Set<string>();
  const serviceDates = new Set<string>();
  let rowCount = 0;
  const allRows = $('#flights-datatable > tbody > tr');
  const flightRows = $('#flights-datatable > tbody > tr.detail');

  if (allRows.length > 0 && flightRows.length === 0) {
    warnings.push({
      code: 'MALFORMED_ROW',
      message: 'Macau Airport board rows did not match the expected structure.',
    });
  }

  flightRows.each((rowIndex, element) => {
    const row = $(element);
    const cells = row.children('td').toArray();
    const serviceDate = cleanText(row.attr('data-flight-date') ?? '');
    if (macauInstant(serviceDate, '00:00')) serviceDates.add(serviceDate);
    if (requestedServiceDate && serviceDate !== requestedServiceDate) return;
    rowCount += 1;
    const scheduledTime = cleanText($(cells[0]).text());
    const airportName = cleanText($(cells[2]).text());
    const flightNumber = cleanText($(cells[3]).text())
      .replace(/\s+/g, '')
      .toUpperCase();
    const statusIndex = document.direction === 'DEPARTURE' ? 5 : 4;
    const rawStatus = cleanText($(cells[statusIndex]).text());
    const gateText =
      document.direction === 'DEPARTURE'
        ? cleanText($(cells[4]).text()) || null
        : null;

    const scheduledAt = macauInstant(serviceDate, scheduledTime);
    if (!flightNumber || cells.length <= statusIndex || !rawStatus) {
      warnings.push({
        code: 'MALFORMED_ROW',
        message: 'Skipped Macau Airport row with invalid required fields.',
        rowIndex,
        details: { serviceDate, scheduledTime, airportName, gateText },
      });
      return;
    }
    if (!flightNumber.startsWith('NX')) return;
    if (!/^NX\d+[A-Z]*$/.test(flightNumber) || !scheduledAt || !airportName) {
      warnings.push({
        code: 'MALFORMED_ROW',
        message: 'Skipped Macau Airport row with invalid required fields.',
        rowIndex,
        flightNumber,
        details: { serviceDate, scheduledTime, airportName, gateText },
      });
      return;
    }

    const airport = resolveAirport(airportName);
    if (airport.code === null) {
      warnings.push({
        code: 'UNKNOWN_AIRPORT',
        message: `Unknown airport: ${airportName}.`,
        rowIndex,
        flightNumber,
        details: { airportName },
      });
    }

    const parsedStatus = parseStatus(
      rawStatus,
      scheduledAt,
      rowIndex,
      flightNumber,
    );
    if (parsedStatus.warning) warnings.push(parsedStatus.warning);

    const candidate: NormalizedFlight = {
      flightNumber,
      serviceDate,
      direction: document.direction,
      scheduledAt,
      estimatedAt: parsedStatus.estimatedAt,
      actualAt: parsedStatus.actualAt,
      origin: document.direction === 'ARRIVAL' ? airport : MACAU_AIRPORT,
      destination: document.direction === 'DEPARTURE' ? airport : MACAU_AIRPORT,
      sourceStatus: parsedStatus.status,
      rawStatus,
    };
    const validated = NormalizedFlightSchema.safeParse(candidate);
    if (!validated.success) {
      warnings.push({
        code: 'MALFORMED_ROW',
        message: 'Skipped row that violated the normalized flight contract.',
        rowIndex,
        flightNumber,
        details: { issues: validated.error.issues },
      });
      return;
    }
    const flight = validated.data;
    const key = flightKey(flight);
    const existing = seen.get(key);
    if (existing) {
      const identical = sameObservation(existing, flight);
      warnings.push({
        code: 'DUPLICATE_ROW',
        message: identical
          ? `Skipped duplicate flight row for ${flightNumber}.`
          : `Suppressed conflicting flight rows for ${flightNumber}.`,
        rowIndex,
        flightNumber,
      });
      if (!identical) {
        const existingIndex = flights.indexOf(existing);
        if (existingIndex >= 0) flights.splice(existingIndex, 1);
        seen.delete(key);
        conflicted.add(key);
      }
      return;
    }
    if (conflicted.has(key)) return;

    seen.set(key, flight);
    flights.push(flight);
  });

  return {
    flights,
    warnings,
    serviceDates: [...serviceDates].sort(),
    rowCount,
  };
}

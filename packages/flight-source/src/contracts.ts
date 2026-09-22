import { z } from 'zod';

export const FlightDirectionSchema = z.enum(['DEPARTURE', 'ARRIVAL']);
export type FlightDirection = z.infer<typeof FlightDirectionSchema>;

export const SourceFlightStatusSchema = z.enum([
  'SCHEDULED',
  'DELAYED',
  'DEPARTED',
  'ARRIVED',
  'CANCELLED',
  'DIVERTED',
  'UNKNOWN',
]);
export type SourceFlightStatus = z.infer<typeof SourceFlightStatusSchema>;

export const AirportReferenceSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  name: z.string().trim().min(1),
});
export type AirportReference = z.infer<typeof AirportReferenceSchema>;

export const RawAirportFlightSchema = z.object({
  direction: FlightDirectionSchema,
  flightNumberText: z.string(),
  scheduledDateText: z.string(),
  scheduledTimeText: z.string(),
  estimatedTimeText: z.string().nullable(),
  actualTimeText: z.string().nullable(),
  airportText: z.string(),
  statusText: z.string(),
  gateText: z.string().nullable(),
  sourceUpdatedAtText: z.string().nullable(),
});
export type RawAirportFlight = z.infer<typeof RawAirportFlightSchema>;

export const NormalizedFlightSchema = z.object({
  flightNumber: z.string().trim().min(2).max(12),
  serviceDate: z.iso.date(),
  direction: FlightDirectionSchema,
  scheduledAt: z.date(),
  estimatedAt: z.date().nullable(),
  actualAt: z.date().nullable(),
  origin: AirportReferenceSchema,
  destination: AirportReferenceSchema,
  sourceStatus: SourceFlightStatusSchema,
  rawStatus: z.string(),
});
export type NormalizedFlight = z.infer<typeof NormalizedFlightSchema>;

export const FlightSourceWarningSchema = z.object({
  code: z.enum([
    'UNKNOWN_AIRPORT',
    'UNKNOWN_STATUS',
    'MALFORMED_ROW',
    'AMBIGUOUS_TIME',
    'DUPLICATE_ROW',
    'SOURCE_PARTIAL',
  ]),
  message: z.string().min(1),
  rowIndex: z.number().int().nonnegative().optional(),
  flightNumber: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type FlightSourceWarning = z.infer<typeof FlightSourceWarningSchema>;

const fetchMetadataSchema = z.object({
  fetchedAt: z.date(),
  sourceUpdatedAt: z.date().nullable(),
  warnings: z.array(FlightSourceWarningSchema),
});

const usableResultSchema = fetchMetadataSchema.extend({
  status: z.enum(['COMPLETE', 'PARTIAL']),
  flights: z.array(NormalizedFlightSchema),
});

export const FlightSourceFailureSchema = z.object({
  code: z.enum(['TIMEOUT', 'HTTP_ERROR', 'MALFORMED_RESPONSE']),
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type FlightSourceFailure = z.infer<typeof FlightSourceFailureSchema>;

const failedResultSchema = fetchMetadataSchema.extend({
  status: z.literal('FAILED'),
  flights: z.tuple([]),
  error: FlightSourceFailureSchema,
});

export const FlightSourceFetchResultSchema = z.discriminatedUnion('status', [
  usableResultSchema.extend({ status: z.literal('COMPLETE') }),
  usableResultSchema.extend({ status: z.literal('PARTIAL') }),
  failedResultSchema,
]);
export type FlightSourceFetchResult = z.infer<
  typeof FlightSourceFetchResultSchema
>;

export const FlightSourceRequestSchema = z.object({
  serviceDate: z.iso.date(),
  directions: z.array(FlightDirectionSchema).min(1),
});
export type FlightSourceRequest = z.infer<typeof FlightSourceRequestSchema>;

export interface FlightSourceAdapter {
  fetchFlights(request: FlightSourceRequest): Promise<FlightSourceFetchResult>;
}

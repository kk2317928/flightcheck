import { z } from 'zod';

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, 'Invalid calendar date');

const page = z.coerce.number().int().positive().default(1);
const pageSize = z.coerce
  .number()
  .int()
  .positive()
  .transform((value) => Math.min(value, 100))
  .default(20);

export const FlightListQuerySchema = z.object({
  date: dateKey.optional(),
  direction: z.enum(['DEPARTURE', 'ARRIVAL']).optional(),
  flight: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^NX\d+[A-Z]?$/)
    .optional(),
  page,
  pageSize,
});

export const FlightDetailsQuerySchema = z.object({
  flight: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^NX\d+[A-Z]?$/),
  date: dateKey.optional(),
  direction: z.enum(['DEPARTURE', 'ARRIVAL']).optional(),
});

export const ServiceDateSchema = dateKey;
export type FlightListQuery = z.infer<typeof FlightListQuerySchema>;

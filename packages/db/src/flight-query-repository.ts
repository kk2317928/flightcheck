import type {
  FlightDirection,
  PrismaClient,
} from './generated/prisma/client.js';

export interface FlightListInput {
  date?: string;
  direction?: FlightDirection;
  flight?: string;
  page: number;
  pageSize: number;
}
export interface FlightDetailsInput {
  flight: string;
  date?: string;
  direction?: FlightDirection;
}

const publicFlightSelect = {
  id: true,
  serviceDate: true,
  direction: true,
  scheduledAt: true,
  estimatedAt: true,
  actualAt: true,
  originCode: true,
  destinationCode: true,
  gate: true,
  operationalStatus: true,
  performanceStatus: true,
  delayMinutes: true,
  updatedAt: true,
  flight: { select: { flightNumber: true } },
} as const;

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
function flatten<T extends { flight: { flightNumber: string } }>(record: T) {
  const { flight, ...rest } = record;
  return { ...rest, flightNumber: flight.flightNumber };
}

export type PublicFlightRecord = ReturnType<
  typeof flatten<{
    id: string;
    serviceDate: Date;
    direction: FlightDirection;
    scheduledAt: Date;
    estimatedAt: Date | null;
    actualAt: Date | null;
    originCode: string | null;
    destinationCode: string | null;
    gate: string | null;
    operationalStatus: string;
    performanceStatus: string;
    delayMinutes: number | null;
    updatedAt: Date;
    flight: { flightNumber: string };
  }>
>;

export function createFlightQueryRepository(prisma: PrismaClient) {
  async function list(input: FlightListInput, operationalStatus?: 'CANCELLED') {
    const where = {
      ...(input.date ? { serviceDate: date(input.date) } : {}),
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.flight ? { flight: { flightNumber: input.flight } } : {}),
      ...(operationalStatus ? { operationalStatus } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.flightInstance.findMany({
        where,
        select: publicFlightSelect,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      prisma.flightInstance.count({ where }),
    ]);
    return { items: items.map(flatten), total };
  }
  return {
    async getDailySummary(serviceDate: string) {
      return prisma.dailyStatistic.findUnique({
        where: { serviceDate: date(serviceDate) },
      });
    },
    async listFlights(input: FlightListInput) {
      return list(input);
    },
    async getFlightDetails(input: FlightDetailsInput) {
      const item = await prisma.flightInstance.findFirst({
        where: {
          flight: { flightNumber: input.flight },
          ...(input.date ? { serviceDate: date(input.date) } : {}),
          ...(input.direction ? { direction: input.direction } : {}),
        },
        select: publicFlightSelect,
        orderBy: [
          { serviceDate: 'desc' },
          { scheduledAt: 'desc' },
          { id: 'desc' },
        ],
      });
      return item ? flatten(item) : null;
    },
    async listHistory(input: FlightListInput) {
      return list(input);
    },
    async listCancellations(input: Omit<FlightListInput, 'flight'>) {
      return list(input, 'CANCELLED');
    },
  };
}

export type FlightQueryRepository = ReturnType<
  typeof createFlightQueryRepository
>;

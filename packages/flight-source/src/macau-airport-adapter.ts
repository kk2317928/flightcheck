import type {
  FlightSourceAdapter,
  FlightSourceFetchResult,
  FlightSourceRequest,
  FlightSourceWarning,
} from './contracts.js';
import type {
  MacauAirportBoardClient,
  MacauAirportDocument,
} from './macau-airport-client.js';
import { parseMacauAirportDocument } from './macau-airport-parser.js';

function latestDate(
  documents: MacauAirportDocument[],
  select: (document: MacauAirportDocument) => Date | null,
): Date | null {
  const timestamps = documents
    .map(select)
    .filter((value): value is Date => value !== null)
    .map((value) => value.getTime());
  return timestamps.length === 0 ? null : new Date(Math.max(...timestamps));
}

export class MacauAirportFlightSource implements FlightSourceAdapter {
  constructor(
    private readonly client: MacauAirportBoardClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetchFlights(
    request: FlightSourceRequest,
  ): Promise<FlightSourceFetchResult> {
    const boardResult = await this.client.fetchBoards(request.directions);
    if (boardResult.status === 'FAILED') {
      const failure = boardResult.errors[0];
      return {
        status: 'FAILED',
        flights: [],
        warnings: [],
        rowCount: 0,
        fetchedAt: this.now(),
        sourceUpdatedAt: null,
        error: {
          code: failure?.code ?? 'MALFORMED_RESPONSE',
          message: failure?.message ?? 'Macau Airport returned no documents.',
          retryable: failure?.retryable ?? false,
        },
      };
    }

    const parsed = boardResult.documents.map((document) => ({
      direction: document.direction,
      result: parseMacauAirportDocument(document, request.serviceDate),
    }));
    const flights = parsed
      .flatMap(({ result }) => result.flights)
      .filter(({ serviceDate }) => serviceDate === request.serviceDate);
    const warnings = parsed.flatMap(({ result }) => result.warnings);
    const rowCount = parsed.reduce(
      (sum, { result }) => sum + result.rowCount,
      0,
    );

    for (const { direction, result } of parsed) {
      if (!result.serviceDates.includes(request.serviceDate)) {
        warnings.push({
          code: 'SOURCE_PARTIAL',
          message: `Macau Airport ${direction.toLowerCase()} board did not cover ${request.serviceDate}.`,
          details: {
            direction,
            serviceDate: request.serviceDate,
            availableServiceDates: result.serviceDates,
          },
        });
      }
    }

    if (boardResult.status === 'PARTIAL') {
      const missingDirections = boardResult.errors.map(({ direction }) =>
        direction.toLowerCase(),
      );
      const partialWarning: FlightSourceWarning = {
        code: 'SOURCE_PARTIAL',
        message: `Macau Airport source was partial: ${missingDirections.join(', ')} unavailable.`,
        details: { missingDirections },
      };
      warnings.push(partialWarning);
    }

    return {
      status:
        boardResult.status === 'PARTIAL' || warnings.length > 0
          ? 'PARTIAL'
          : 'COMPLETE',
      flights,
      warnings,
      rowCount,
      fetchedAt:
        latestDate(boardResult.documents, ({ fetchedAt }) => fetchedAt) ??
        this.now(),
      sourceUpdatedAt: latestDate(
        boardResult.documents,
        ({ sourceUpdatedAt }) => sourceUpdatedAt,
      ),
    };
  }
}

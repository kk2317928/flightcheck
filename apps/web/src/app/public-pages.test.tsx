import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  getDailySummary: vi.fn(),
  listFlights: vi.fn(),
  getFlightDetails: vi.fn(),
  listHistory: vi.fn(),
  listCancellations: vi.fn(),
}));
vi.mock('../lib/flights/query-runtime', () => ({
  getFlightQueryService: () => service,
}));

const flight = {
  id: 'one',
  flightNumber: 'NX862D',
  serviceDate: new Date('2026-09-22'),
  direction: 'DEPARTURE',
  scheduledAt: new Date('2026-09-22T08:00:00Z'),
  estimatedAt: null,
  actualAt: null,
  originCode: 'MFM',
  destinationCode: 'TPE',
  gate: '12',
  operationalStatus: 'SCHEDULED',
  performanceStatus: 'PENDING',
  delayMinutes: null,
  updatedAt: new Date('2026-09-22T07:55:00Z'),
};

describe('public pages', () => {
  beforeEach(() => {
    service.getDailySummary.mockResolvedValue({
      totalFlights: 2,
      cancelledFlights: 1,
      cancellationRate: 0.5,
      onTimeRate: null,
      averageDelayMinutes: null,
      dataQuality: 'DEGRADED',
      lastUpdatedAt: new Date('2026-09-22T15:30:00Z'),
    });
    service.listFlights.mockResolvedValue({
      items: [flight],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    service.getFlightDetails.mockResolvedValue(flight);
    service.listHistory.mockResolvedValue({
      items: [
        flight,
        {
          ...flight,
          id: 'two',
          direction: 'ARRIVAL',
          serviceDate: new Date('2026-09-23'),
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    service.listCancellations.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('renders truthful degraded statistics and an encoded flight link', async () => {
    const { default: HomePage } = await import('./page');
    const html = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ date: '2026-09-22' }) }),
    );
    expect(html).toContain('總航班');
    expect(html).toContain('資料不完整');
    expect(html).toContain('N/A');
    expect(html).toContain('/flights/NX862D');
  });

  it('renders a clear empty state instead of zero statistics', async () => {
    service.getDailySummary.mockResolvedValue(null);
    service.listFlights.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const { default: HomePage } = await import('./page');
    const html = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ date: '2026-09-24' }) }),
    );
    expect(html).toContain('尚無資料');
    expect(html).not.toContain('0%');
  });

  it('keeps same flight numbers separated by date and direction in history', async () => {
    const { default: HistoryPage } = await import('./history/page');
    const html = renderToStaticMarkup(
      await HistoryPage({
        searchParams: Promise.resolve({ flight: 'NX862D' }),
      }),
    );
    expect(html).toContain('2026-09-22');
    expect(html).toContain('2026-09-23');
    expect(html).toContain('出發');
    expect(html).toContain('抵達');
  });

  it('renders missing flight details as a 404', async () => {
    service.getFlightDetails.mockResolvedValue(null);
    const { default: FlightDetailsPage } =
      await import('./flights/[flight]/page');
    await expect(
      FlightDetailsPage({
        params: Promise.resolve({ flight: 'NX404' }),
        searchParams: Promise.resolve({ date: '2026-09-22' }),
      }),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });
});

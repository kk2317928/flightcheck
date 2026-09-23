import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const database = vi.hoisted(() => ({
  flightInstance: { findMany: vi.fn().mockResolvedValue([]) },
  scrapeRun: { findMany: vi.fn().mockResolvedValue([]) },
  dailyStatistic: { findMany: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../lib/db', () => ({ getDatabase: () => database }));
describe('launch Admin views', () => {
  it('links the operational dashboard sections', async () => {
    const { default: Page } = await import('./page');
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('/admin/flights');
    expect(html).toContain('/admin/scrape-runs');
    expect(html).toContain('/admin/statistics');
  });
  it.each([
    [() => import('./flights/page'), '航班管理'],
    [() => import('./scrape-runs/page'), '同步狀態'],
    [() => import('./statistics/page'), '每日統計'],
  ])('renders %s', async (module, heading) => {
    const { default: Page } = await module();
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain(heading);
  });
});

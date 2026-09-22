import { expect, test } from '@playwright/test';

test('serves the FlightCheck foundation and health endpoint', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'FlightCheck' }),
  ).toBeVisible();

  const healthResponse = await request.get('/api/health');
  expect(healthResponse.ok()).toBe(true);
  await expect(healthResponse.json()).resolves.toEqual({
    service: 'web',
    status: 'ok',
  });
});

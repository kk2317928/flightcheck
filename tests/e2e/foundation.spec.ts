import { expect, test } from '@playwright/test';

test('serves the public dashboard and health endpoint without authentication', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '澳門航空航班動態' }),
  ).toBeVisible();

  const healthResponse = await request.get('/api/health');
  expect(healthResponse.ok()).toBe(true);
  await expect(healthResponse.json()).resolves.toEqual({
    service: 'web',
    status: 'ok',
  });
});

for (const viewport of [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`${viewport.name} dashboard is keyboard accessible without page overflow`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}

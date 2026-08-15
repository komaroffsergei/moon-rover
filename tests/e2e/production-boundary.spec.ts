import { expect, test } from '@playwright/test';

import { watchPageHealth } from './dispatcher-helpers';

test('production игнорирует E2E fixture и не публикует diagnostics marker', async ({
  page,
}) => {
  test.skip(
    process.env.PLAYWRIGHT_PRODUCTION_BOUNDARY !== '1',
    'Runs only against the production image boundary.',
  );
  test.setTimeout(90_000);
  const health = watchPageHealth(page);

  await page.goto('/?e2e=1&scenario=victory-away');
  await page.getByRole('button', { name: /Разлом Шеклтона/i }).click();
  await page.getByRole('button', { name: 'Продолжить к брифингу' }).click();
  await page.getByRole('button', { name: 'Начать смену' }).click();

  const host = page.getByTestId('game-host');
  await expect(host).toHaveAttribute('data-map-ready', 'true', {
    timeout: 30_000,
  });
  await page.waitForTimeout(2_000);
  await expect(host).not.toHaveAttribute('data-map-state');
  await expect(
    page.getByRole('dialog', { name: 'Смена завершена' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Поставить смену на паузу' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Открыть рацию' }),
  ).toBeVisible();
  const mapBox = await page.getByTestId('map-region').boundingBox();
  expect(mapBox).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  health.assertClean();
});

import { expect, test } from '@playwright/test';

import {
  selectRover,
  startDispatcher,
  watchPageHealth,
} from './dispatcher-helpers';

test('нижние controls остаются icon-only и не переполняют свои границы', async ({
  page,
}) => {
  const health = watchPageHealth(page);
  await startDispatcher(page);

  const controls = [
    page.getByRole('button', { name: 'Поставить смену на паузу' }),
    page.getByRole('button', { name: 'Открыть рацию' }),
  ];

  for (const control of controls) {
    await expect(control).toBeVisible();
    const metrics = await control.evaluate((element) => ({
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      visibleText: element.textContent?.trim() ?? '',
    }));

    expect(metrics.clientWidth).toBeGreaterThanOrEqual(44);
    expect(metrics.clientHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
    expect(metrics.visibleText).not.toMatch(/[A-Za-zА-Яа-яЁё]/);
  }

  health.assertClean();
});

test('рация закрывается обоими controls и открывается повторно', async ({
  page,
}) => {
  const health = watchPageHealth(page);
  await startDispatcher(page);

  const openRadio = page.getByRole('button', { name: 'Открыть рацию' });
  await openRadio.click();

  const drawer = page.locator('.radio-drawer');
  await expect(drawer).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Скрыть рацию' }),
  ).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: 'Свернуть рацию' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(openRadio).toBeFocused();

  await openRadio.click();
  await expect(drawer).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть рацию' }).click();
  await expect(drawer).toHaveCount(0);

  health.assertClean();
});

test('inspector снова открывается при повторном выборе того же объекта', async ({
  page,
}) => {
  const health = watchPageHealth(page);
  await startDispatcher(page);

  await selectRover(page, 'gagarin');
  const inspector = page.getByRole('region', { name: 'Выбранный объект' });
  await expect(inspector).toBeVisible();

  await page
    .getByRole('button', { name: 'Свернуть сведения об объекте' })
    .click();
  await expect(inspector).toHaveCount(0);

  await selectRover(page, 'gagarin');
  await expect(inspector).toBeVisible();

  health.assertClean();
});

import { expect, test, type Page } from '@playwright/test';

import {
  clickCell,
  readMapState,
  selectCenter,
  selectRover,
  startDispatcher,
  watchPageHealth,
} from './dispatcher-helpers';

function selectedBattery(page: Page) {
  return page
    .locator('.selected-panel')
    .getByRole('progressbar', { name: 'Батарея' });
}

test('истощённый центр восстанавливается доставкой через UI', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const health = watchPageHealth(page);
  await startDispatcher(page, { scenario: 'recovery-success' });

  await expect
    .poll(
      async () =>
        (await readMapState(page)).centers.find(
          ({ id }) => id === 'aristarchus',
        )?.status,
    )
    .toBe('RECOVERY');
  await selectRover(page, 'gagarin');
  await page
    .getByRole('button', { name: 'Разгрузить в Центр Аристарх' })
    .click();
  await expect
    .poll(
      async () =>
        (await readMapState(page)).centers.find(
          ({ id }) => id === 'aristarchus',
        )?.status,
    )
    .toBe('WARNING');
  health.assertClean();
});

test('истечение полного recovery window завершает смену поражением', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const health = watchPageHealth(page);
  await startDispatcher(page, { scenario: 'recovery-defeat' });

  await selectCenter(page, 'aristarchus');
  await expect(
    page.getByLabel('Выбранный объект').getByRole('status').filter({
      hasText: 'Критическое восстановление',
    }),
  ).toBeVisible({ timeout: 10_000 });
  const dialog = page.getByRole('dialog', { name: 'Миссия потеряна' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText('Потерян центр: Центр Аристарх.');
  await expect
    .poll(async () => (await readMapState(page)).speechBubbles)
    .toEqual([]);
  health.assertClean();
});

test('детерминированный метеорит ремонтируется штатной UI-командой', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const health = watchPageHealth(page);
  await startDispatcher(page, { scenario: 'meteor-repair' });
  await selectRover(page, 'gagarin');

  await clickCell(page, { column: 3, row: 5 }, 'right');
  await expect
    .poll(async () => {
      const rover = (await readMapState(page)).rovers.find(
        ({ id }) => id === 'gagarin',
      );
      return rover?.route?.steps.at(-1);
    })
    .toEqual({ column: 3, row: 5 });

  const selectedPanel = page.getByLabel('Выбранный объект');
  await expect(
    selectedPanel.getByText('Повреждён', { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText('Требуется ремонтный ровер в соседней клетке.'),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await readMapState(page)).speechBubbles.find(
          ({ eventCode }) => eventCode === 'incident.meteor.courier',
        ),
      { timeout: 10_000 },
    )
    .toMatchObject({
      objectId: 'gagarin',
      sourceKind: 'ROVER',
      text: 'В меня попал метеорит. Нужна ремонтная бригада.',
    });
  await page.getByRole('button', { name: 'Начать ремонт: Королёв' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Ремонт выполняется' }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await readMapState(page)).speechBubbles.find(
          ({ eventCode }) => eventCode === 'rescue.repair.started',
        ),
      { timeout: 10_000 },
    )
    .toMatchObject({
      objectId: 'korolev',
      sourceKind: 'EMERGENCY',
      text: 'Начинаю ремонт курьера. Мне нужно 5 минут.',
    });
  await expect(
    selectedPanel.getByText('Ожидает на карте', { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText('Требуется ремонтный ровер в соседней клетке.'),
  ).toHaveCount(0);
  health.assertClean();
});

test('полный заряд донора передаётся ремонтному роверу только после подтверждения', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const health = watchPageHealth(page);
  await startDispatcher(page, { scenario: 'battery-transfer' });
  await selectRover(page, 'gagarin');
  await expect(selectedBattery(page)).toHaveAttribute('aria-valuenow', '100');

  await page.getByRole('button', { name: 'Передать батарею Королёв' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Подтвердить передачу батареи',
  });
  await expect(dialog.getByText('Донор после').locator('..')).toContainText(
    '0',
  );
  await expect(
    dialog.getByText('Получатель после').locator('..'),
  ).toContainText('100');
  await expect(selectedBattery(page)).toHaveAttribute('aria-valuenow', '100');
  await dialog.getByRole('button', { name: 'Передать заряд' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(selectedBattery(page)).toHaveAttribute('aria-valuenow', '0');
  await selectRover(page, 'korolev');
  await expect(selectedBattery(page)).toHaveAttribute('aria-valuenow', '100');
  health.assertClean();
});

test('смена завершается победой, пока курьер остаётся вне базы', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const health = watchPageHealth(page);
  await startDispatcher(page, { scenario: 'victory-away' });
  await selectRover(page, 'gagarin');
  await expect(
    page
      .getByLabel('Выбранный объект')
      .getByText('Ожидает на карте', { exact: true }),
  ).toBeVisible();

  const dialog = page.getByRole('dialog', { name: 'Смена завершена' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText(
    'Все действующие центры пережили рабочую смену.',
  );
  await expect
    .poll(async () => (await readMapState(page)).speechBubbles)
    .toEqual([]);
  health.assertClean();
});

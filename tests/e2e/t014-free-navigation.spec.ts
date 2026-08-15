import { expect, test } from '@playwright/test';

import {
  clickCell,
  readMapState,
  selectRover,
  startDispatcher,
  watchPageHealth,
} from './dispatcher-helpers';

const LEVELS = [
  'Кратер Тихо',
  'Разлом Шеклтона',
  'Море Спокойствия',
  'Южный полюс',
  'Лабиринт Эйткена',
] as const;

function sameCell(
  left: { readonly column: number; readonly row: number },
  right: { readonly column: number; readonly row: number },
): boolean {
  return left.column === right.column && left.row === right.row;
}

test('all five maps render procedural centers and allow a center in a hazard', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const health = watchPageHealth(page);
  let hazardousCenterSeen = false;

  for (const levelName of LEVELS) {
    await startDispatcher(page, { levelName, placement: 'procedural' });
    const state = await readMapState(page);
    expect(state.centers.length).toBeGreaterThan(0);
    expect(
      new Set(state.centers.map(({ cell }) => `${cell.column}:${cell.row}`))
        .size,
    ).toBe(state.centers.length);
    hazardousCenterSeen ||= state.centers.some(({ cell }) =>
      state.hazardCells.some((hazard) => sameCell(cell, hazard)),
    );
  }

  expect(hazardousCenterSeen).toBe(true);
  health.assertClean();
});

test('arrival fills every center stock and keeps capped cargo remainder', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const health = watchPageHealth(page);
  await startDispatcher(page, { scenario: 'full-cargo-delivery' });

  const initial = await readMapState(page);
  const center = initial.centers.find(({ id }) => id === 'aristarchus');
  const rover = initial.rovers.find(({ id }) => id === 'gagarin');
  if (!center || !rover) throw new Error('Delivery fixture is incomplete');
  expect(rover.cargo).toEqual({ oxygen: 20, food: 20, equipment: 20 });

  await selectRover(page, 'gagarin');
  await page
    .getByRole('button', { name: 'Свернуть сведения об объекте' })
    .click();
  await clickCell(page, center.cell, 'right');
  await expect
    .poll(
      async () => {
        const current = (await readMapState(page)).rovers.find(
          ({ id }) => id === rover.id,
        );
        return current?.route === null && sameCell(current.cell, center.cell);
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  const final = await readMapState(page);
  const deliveredCenter = final.centers.find(({ id }) => id === center.id)!;
  const deliveredRover = final.rovers.find(({ id }) => id === rover.id)!;
  expect(deliveredCenter.resources.oxygen).toBeGreaterThan(99.5);
  expect(deliveredCenter.resources.food).toBeGreaterThan(99.5);
  expect(deliveredCenter.resources.equipment).toBe(100);
  expect(deliveredRover.cargo.oxygen).toBeGreaterThan(0);
  expect(deliveredRover.cargo.food).toBeGreaterThan(0);
  expect(deliveredRover.cargo.equipment).toBe(15);
  expect(deliveredRover.cargo.oxygen).toBeLessThan(20);
  expect(deliveredRover.cargo.food).toBeLessThan(20);
  health.assertClean();
});

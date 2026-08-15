import { expect, test } from '@playwright/test';

import {
  readMapState,
  selectRover,
  watchPageHealth,
} from './dispatcher-helpers';

const LEVELS = [
  {
    slug: 'tycho',
    title: 'Кратер Тихо',
    background: '/assets/maps/tycho/background.webp',
    centers: 2,
  },
  {
    slug: 'shackleton',
    title: 'Разлом Шеклтона',
    background: '/assets/maps/shackleton/background.webp',
    centers: 3,
  },
  {
    slug: 'tranquility',
    title: 'Море Спокойствия',
    background: '/assets/maps/tranquility/background.webp',
    centers: 4,
  },
  {
    slug: 'south-pole',
    title: 'Южный полюс',
    background: '/assets/maps/south-pole/background.webp',
    centers: 5,
  },
  {
    slug: 'aitken',
    title: 'Лабиринт Эйткена',
    background: '/assets/maps/aitken/background.webp',
    centers: 6,
  },
] as const;

test('каждая карта выбирается и запускается без загрузки всего каталога фонов', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const health = watchPageHealth(page);

  for (const level of LEVELS) {
    await page.goto('/?e2e=1');
    await expect(page.locator('.level-card')).toHaveCount(5);
    await page
      .getByRole('button', { name: new RegExp(level.title, 'i') })
      .click();

    const preview = page.getByAltText('Лунная поверхность уровня');
    await expect(preview).toHaveAttribute('src', level.background);
    await expect(page.locator('.level-preview img')).toHaveCount(1);
    await expect
      .poll(() =>
        preview.evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const loadedBackgrounds = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map(({ name }) => name)
        .filter((name) =>
          /\/assets\/maps\/[^/]+\/background\.webp$/.test(name),
        ),
    );
    const uniqueBackgrounds = [...new Set(loadedBackgrounds)];
    expect(
      uniqueBackgrounds.some((url) => url.endsWith(level.background)),
    ).toBe(true);
    expect(uniqueBackgrounds.length).toBeLessThanOrEqual(2);
    expect(
      uniqueBackgrounds.every(
        (url) =>
          url.endsWith(level.background) ||
          url.endsWith('/assets/maps/shackleton/background.webp'),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Продолжить к брифингу' }).click();
    await expect(
      page.getByRole('heading', { name: level.title }),
    ).toBeVisible();
    await expect(page.locator('.briefing-map__marker--centers')).toContainText(
      String(level.centers),
    );
    await page.getByRole('button', { name: 'Начать смену' }).click();
    await expect(page.getByTestId('game-host')).toHaveAttribute(
      'data-map-ready',
      'true',
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole('heading', { name: level.title }),
    ).toBeVisible();
    await expect(page.getByTestId('game-host').locator('canvas')).toHaveCount(
      1,
    );
    if (level.slug === 'aitken') {
      const roverIds = (await readMapState(page)).rovers.map(({ id }) => id);
      expect(roverIds).toHaveLength(6);
      for (const roverId of roverIds) await selectRover(page, roverId);
    }
  }

  health.assertClean();
});

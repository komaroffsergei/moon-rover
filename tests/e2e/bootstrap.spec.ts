import { expect, test, type Page } from '@playwright/test';

import {
  readMapState,
  selectRover,
  startDispatcher,
  watchPageHealth,
} from './dispatcher-helpers';

interface DispatcherGeometry {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly scroll: { readonly width: number; readonly height: number };
  readonly shell: { readonly width: number; readonly height: number };
  readonly map: { readonly width: number; readonly height: number };
}

async function readGeometry(page: Page): Promise<DispatcherGeometry> {
  return page.evaluate(() => {
    const required = (selector: string): HTMLElement => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing layout element: ${selector}`);
      return element;
    };
    const shell = required('[data-testid="app-shell"]').getBoundingClientRect();
    const map = required('[data-testid="map-region"]').getBoundingClientRect();

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      shell: { width: shell.width, height: shell.height },
      map: { width: map.width, height: map.height },
    };
  });
}

function expectFullscreenMap(geometry: DispatcherGeometry): void {
  expect(geometry.map.width / geometry.shell.width).toBeGreaterThanOrEqual(
    0.99,
  );
  expect(geometry.map.height / geometry.shell.height).toBeGreaterThanOrEqual(
    0.99,
  );
  expect(geometry.scroll.width).toBeLessThanOrEqual(
    geometry.viewport.width + 1,
  );
  expect(geometry.scroll.height).toBeLessThanOrEqual(
    geometry.viewport.height + 1,
  );
}

test('preflight ведёт в полноэкранную карту без ошибок', async ({ page }) => {
  test.setTimeout(90_000);
  const health = watchPageHealth(page);

  await page.goto('/?e2e=1');
  await expect(page).toHaveTitle('Moon Courier Crisis');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Выбор уровня' }),
  ).toBeVisible();
  await expect(page.locator('.level-card')).toHaveCount(5);
  await page.getByRole('button', { name: /Разлом Шеклтона/i }).click();
  await expect(
    page.getByRole('heading', { name: 'Разлом Шеклтона' }),
  ).toBeVisible();
  await expect(page.getByAltText('Лунная поверхность уровня')).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Продолжить к брифингу' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Брифинг миссии' }),
  ).toBeVisible();
  await expect(page.getByText('Главная цель')).toHaveCount(0);
  await expect(page.getByText('Цель смены')).toBeVisible();
  await expect(page.getByText('Средний риск')).toBeVisible();
  await page.getByRole('button', { name: 'Начать смену' }).click();

  const host = page.getByTestId('game-host');
  await expect(host).toHaveAttribute('data-map-ready', 'true', {
    timeout: 30_000,
  });
  await expect
    .poll(async () => (await readMapState(page)).phase)
    .toBe('RUNNING');
  await expect(host.locator('canvas')).toHaveCount(1);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(
    page.locator('.game-topbar, .game-sidebar, .overview-card'),
  ).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(0);

  const compact = await readGeometry(page);
  expect(compact.viewport).toEqual({ width: 1280, height: 720 });
  expectFullscreenMap(compact);

  const controls = [
    page.getByRole('button', { name: 'Поставить смену на паузу' }),
    page.getByRole('button', { name: 'Открыть рацию' }),
  ];
  for (const control of controls) {
    const dimensions = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        fontSize: Number.parseFloat(style.fontSize),
      };
    });
    expect(dimensions.height).toBeGreaterThanOrEqual(44);
    expect(dimensions.fontSize).toBeGreaterThanOrEqual(12);
  }

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('Tab');
  const focusStyle = await page.locator(':focus').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(3);

  await controls[0]!.click();
  const pauseDialog = page.getByRole('dialog', {
    name: 'Смена приостановлена',
  });
  await expect(pauseDialog).toBeVisible();
  await expect
    .poll(async () => (await readMapState(page)).phase)
    .toBe('PAUSED');
  await page.waitForTimeout(1_200);
  expect((await readMapState(page)).phase).toBe('PAUSED');
  await page.keyboard.press('Escape');
  await expect(pauseDialog).toHaveCount(0);
  await expect
    .poll(async () => (await readMapState(page)).phase)
    .toBe('RUNNING');

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('Space');
  await expect(pauseDialog).toBeVisible();
  await page.keyboard.press('Space');
  await expect(pauseDialog).toHaveCount(0);

  await selectRover(page, 'gagarin');
  const oxygenInput = page.getByRole('spinbutton', { name: 'Кислород' });
  await oxygenInput.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await readMapState(page)).phase).toBe('RUNNING');

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(host.locator('canvas')).toBeVisible();
  expectFullscreenMap(await readGeometry(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(host.locator('canvas')).toBeVisible();
  const resized = await readGeometry(page);
  expect(resized.viewport).toEqual({ width: 1280, height: 720 });
  expectFullscreenMap(resized);

  health.assertClean();
});

function totalCenterResources(
  pageState: Awaited<ReturnType<typeof readMapState>>,
) {
  return pageState.centers.reduce(
    (total, center) =>
      total +
      center.resources.oxygen +
      center.resources.food +
      center.resources.equipment,
    0,
  );
}

test('активная смена догоняет время после hidden/frozen lifecycle', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const health = watchPageHealth(page);
  await startDispatcher(page);

  const before = totalCenterResources(await readMapState(page));
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  try {
    await page.waitForTimeout(1_400);
  } finally {
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  }

  await expect
    .poll(async () => totalCenterResources(await readMapState(page)), {
      timeout: 3_000,
    })
    .toBeLessThan(before - 0.01);
  await expect
    .poll(() => page.evaluate(() => document.visibilityState))
    .toBe('visible');
  health.assertClean();
});

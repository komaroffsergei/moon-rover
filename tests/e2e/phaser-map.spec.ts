import { expect, test, type Page } from '@playwright/test';

import {
  clickCell,
  readMapState,
  selectRover,
  startDispatcher,
  type Cell,
  type MapState,
  type RouteLeg,
  watchPageHealth,
} from './dispatcher-helpers';

const AITKEN_WORLD = { width: 20 * 64, height: 14 * 64 } as const;

function projectWorldBounds(
  state: MapState,
  viewport: { readonly width: number; readonly height: number },
  world: { readonly width: number; readonly height: number },
) {
  return {
    left: (0 - state.camera.center.x) * state.camera.zoom + viewport.width / 2,
    top: (0 - state.camera.center.y) * state.camera.zoom + viewport.height / 2,
    right:
      (world.width - state.camera.center.x) * state.camera.zoom +
      viewport.width / 2,
    bottom:
      (world.height - state.camera.center.y) * state.camera.zoom +
      viewport.height / 2,
  };
}

async function expectWorldCoversViewport(
  page: Page,
  world: { readonly width: number; readonly height: number },
): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Playwright viewport is unavailable');

  await expect
    .poll(async () => {
      const bounds = projectWorldBounds(
        await readMapState(page),
        viewport,
        world,
      );
      return (
        bounds.left <= 0.5 &&
        bounds.top <= 0.5 &&
        bounds.right >= viewport.width - 0.5 &&
        bounds.bottom >= viewport.height - 0.5
      );
    })
    .toBe(true);
}

async function clickMapZoomButton(
  page: Page,
  direction: 'in' | 'out',
): Promise<void> {
  const canvas = page.getByTestId('game-host').locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');

  await canvas.click({
    position: {
      x: box.width - 31,
      y: box.height - (direction === 'in' ? 83 : 31),
    },
  });
}

function angularDistance(left: number, right: number): number {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

function pointDistance(left: Cell, right: Cell): number {
  return Math.hypot(left.column - right.column, left.row - right.row);
}

function legDirection({ from, to }: RouteLeg): Cell {
  return {
    column: to.column - from.column,
    row: to.row - from.row,
  };
}

function isDiagonalLeg(leg: RouteLeg): boolean {
  const direction = legDirection(leg);
  return Math.abs(direction.column) > 1e-6 && Math.abs(direction.row) > 1e-6;
}

function movementPosition(movement: {
  readonly from: Cell;
  readonly to: Cell;
  readonly progress: number;
}): Cell {
  return {
    column:
      movement.from.column +
      (movement.to.column - movement.from.column) * movement.progress,
    row:
      movement.from.row +
      (movement.to.row - movement.from.row) * movement.progress,
  };
}

function screenRectsOverlap(
  left: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  right: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

test('comic radio callouts stay bounded, readable through zoom and frozen on pause', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const health = watchPageHealth(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await startDispatcher(page, { levelName: 'Кратер Тихо' });

  await expect
    .poll(async () => (await readMapState(page)).speechBubbles.length)
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      (await readMapState(page)).speechBubbles.every(
        ({ transitioning }) => !transitioning,
      ),
    )
    .toBe(true);

  const initial = await readMapState(page);
  expect(initial.speechBubbles.length).toBeLessThanOrEqual(3);
  expect(initial.speechQueueLength).toBeLessThanOrEqual(12);
  expect(
    new Set(initial.speechBubbles.map(({ objectId }) => objectId)).size,
  ).toBe(initial.speechBubbles.length);
  expect(
    initial.speechBubbles.every(({ sourceKind }) => sourceKind === 'CENTER'),
  ).toBe(true);
  expect(
    initial.speechBubbles.some(({ text }) => text.startsWith('Нам ')),
  ).toBe(true);

  const canvas = page.getByTestId('game-host').locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  for (const bubble of initial.speechBubbles) {
    expect(bubble.screenRect.x).toBeGreaterThanOrEqual(0);
    expect(bubble.screenRect.y).toBeGreaterThanOrEqual(0);
    expect(bubble.screenRect.x + bubble.screenRect.width).toBeLessThanOrEqual(
      box.width,
    );
    expect(bubble.screenRect.y + bubble.screenRect.height).toBeLessThanOrEqual(
      box.height,
    );
  }
  for (let left = 0; left < initial.speechBubbles.length; left += 1) {
    for (
      let right = left + 1;
      right < initial.speechBubbles.length;
      right += 1
    ) {
      expect(
        screenRectsOverlap(
          initial.speechBubbles[left]!.screenRect,
          initial.speechBubbles[right]!.screenRect,
        ),
      ).toBe(false);
    }
  }

  const tracked = initial.speechBubbles[0]!;
  await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => (await readMapState(page)).camera.zoom)
    .toBeGreaterThan(initial.camera.zoom);
  await expect
    .poll(async () => {
      const bubble = (await readMapState(page)).speechBubbles.find(
        ({ messageId }) => messageId === tracked.messageId,
      );
      return bubble
        ? {
            width: bubble.screenRect.width,
            height: bubble.screenRect.height,
            scale: bubble.presentationScale,
          }
        : null;
    })
    .toEqual({
      width: tracked.screenRect.width,
      height: tracked.screenRect.height,
      scale: 1,
    });

  await page.getByRole('button', { name: 'Поставить смену на паузу' }).click();
  await expect
    .poll(async () => (await readMapState(page)).phase)
    .toBe('PAUSED');
  const paused = (await readMapState(page)).speechBubbles.find(
    ({ messageId }) => messageId === tracked.messageId,
  );
  expect(paused).toBeDefined();
  await page.waitForTimeout(500);
  expect(
    (await readMapState(page)).speechBubbles.find(
      ({ messageId }) => messageId === tracked.messageId,
    )?.remainingMilliseconds,
  ).toBe(paused?.remainingMilliseconds);

  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect
    .poll(async () => (await readMapState(page)).phase)
    .toBe('RUNNING');
  await expect
    .poll(
      async () =>
        (await readMapState(page)).speechBubbles.find(
          ({ messageId }) => messageId === tracked.messageId,
        )?.remainingMilliseconds ?? Number.NEGATIVE_INFINITY,
    )
    .toBeLessThan(paused!.remainingMilliseconds);
  health.assertClean();
});

test('пятая карта покрывает viewport, а кнопки и колесо изменяют zoom', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const health = watchPageHealth(page);
  await startDispatcher(page, { levelName: 'Лабиринт Эйткена' });

  await expectWorldCoversViewport(page, AITKEN_WORLD);

  const initialZoom = (await readMapState(page)).camera.zoom;
  await clickMapZoomButton(page, 'in');
  await expect
    .poll(async () => (await readMapState(page)).camera.zoom)
    .toBeGreaterThan(initialZoom);

  const buttonZoom = (await readMapState(page)).camera.zoom;
  await clickMapZoomButton(page, 'out');
  await expect
    .poll(
      async () =>
        Math.abs((await readMapState(page)).camera.zoom - initialZoom) < 1e-6,
    )
    .toBe(true);

  const canvas = page.getByTestId('game-host').locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => (await readMapState(page)).camera.zoom)
    .toBeGreaterThan(buttonZoom);

  const wheelZoom = (await readMapState(page)).camera.zoom;
  await page.mouse.wheel(0, 300);
  await expect
    .poll(
      async () =>
        Math.abs((await readMapState(page)).camera.zoom - initialZoom) < 1e-6,
    )
    .toBe(true);
  expect(wheelZoom).toBeGreaterThan(initialZoom);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectWorldCoversViewport(page, AITKEN_WORLD);
  health.assertClean();
});

test('крестик закрывает комикс-баббл, но сохраняет запись в рации', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const health = watchPageHealth(page);
  await startDispatcher(page, { levelName: 'Кратер Тихо' });

  await expect
    .poll(async () => (await readMapState(page)).speechBubbles.length)
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Открыть рацию' }).click();
  const drawer = page.locator('.radio-drawer');
  await expect(drawer).toBeVisible();
  await expect
    .poll(async () =>
      (await readMapState(page)).speechBubbles.every(
        ({ transitioning }) => !transitioning,
      ),
    )
    .toBe(true);

  const canvas = page.getByTestId('game-host').locator('canvas');
  const canvasBox = await canvas.boundingBox();
  const drawerBox = await drawer.boundingBox();
  if (!canvasBox || !drawerBox) {
    throw new Error('Canvas or radio drawer has no bounding box');
  }
  const drawerCanvasRect = {
    x: drawerBox.x - canvasBox.x,
    y: drawerBox.y - canvasBox.y,
    width: drawerBox.width,
    height: drawerBox.height,
  };
  await expect
    .poll(async () => {
      const bubbles = (await readMapState(page)).speechBubbles;
      return (
        bubbles.length > 0 &&
        bubbles.every(
          ({ screenRect }) => !screenRectsOverlap(screenRect, drawerCanvasRect),
        )
      );
    })
    .toBe(true);
  const visibleBubbles = (await readMapState(page)).speechBubbles;
  const tracked = visibleBubbles[0]!;
  expect(
    visibleBubbles.every(
      ({ screenRect }) => !screenRectsOverlap(screenRect, drawerCanvasRect),
    ),
  ).toBe(true);
  await canvas.click({
    position: {
      x: tracked.closeScreenRect.x + tracked.closeScreenRect.width / 2,
      y: tracked.closeScreenRect.y + tracked.closeScreenRect.height / 2,
    },
  });

  await expect
    .poll(async () =>
      (await readMapState(page)).speechBubbles.some(
        ({ messageId }) => messageId === tracked.messageId,
      ),
    )
    .toBe(false);
  const journal = page.getByRole('list', { name: 'Журнал сообщений' });
  await expect(journal.getByText(tracked.text, { exact: true })).toBeVisible();
  health.assertClean();
});

test('ПКМ сразу отправляет ровер, перестраивает путь и сохраняет pan/zoom', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const health = watchPageHealth(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await startDispatcher(page, { scenario: 'routing-stable' });

  const host = page.getByTestId('game-host');
  const canvas = host.locator('canvas');
  await selectRover(page, 'gagarin');
  await expect(page.getByRole('heading', { name: 'Гагарин' })).toBeVisible();
  await expect(
    page.getByText('Укажите точку на карте — ровер начнёт движение сразу.'),
  ).toBeVisible();

  await canvas.evaluate((canvasElement) => {
    canvasElement.dataset.contextMenuPrevented = 'false';
    canvasElement.addEventListener(
      'contextmenu',
      (event) => {
        canvasElement.dataset.contextMenuPrevented = String(
          event.defaultPrevented,
        );
      },
      { once: true },
    );
  });
  await clickCell(page, { column: 13, row: 8 }, 'right');
  await expect
    .poll(() => canvas.getAttribute('data-context-menu-prevented'))
    .toBe('true');

  await expect(page.getByTestId('route-dock')).toHaveCount(0);
  await expect
    .poll(async () => {
      const rover = (await readMapState(page)).rovers.find(
        ({ id }) => id === 'gagarin',
      );
      return rover?.route?.steps.at(-1);
    })
    .toEqual({ column: 13, row: 8 });
  const initialRoute = (await readMapState(page)).rovers.find(
    ({ id }) => id === 'gagarin',
  )?.route;
  expect(initialRoute?.mode).toBe('FREE_NAVIGATION');
  expect(initialRoute?.legs.some(isDiagonalLeg)).toBe(true);
  await expect
    .poll(
      async () => {
        const rover = (await readMapState(page)).rovers.find(
          ({ id }) => id === 'gagarin',
        );
        return rover?.movement?.progress ?? 0;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0.02);
  const beforeRerouteState = await clickCell(
    page,
    { column: 0, row: 5 },
    'right',
  );
  const beforeReroute = beforeRerouteState.rovers.find(
    ({ id }) => id === 'gagarin',
  );
  if (!beforeReroute?.movement) throw new Error('Rover did not start moving');
  const beforeReroutePosition = movementPosition(beforeReroute.movement);
  const oldDirection = {
    column:
      beforeReroute.movement.to.column - beforeReroute.movement.from.column,
    row: beforeReroute.movement.to.row - beforeReroute.movement.from.row,
  };

  await expect
    .poll(async () => {
      const rover = (await readMapState(page)).rovers.find(
        ({ id }) => id === 'gagarin',
      );
      return rover?.route?.steps.at(-1);
    })
    .toEqual({ column: 0, row: 5 });
  const afterReroute = (await readMapState(page)).rovers.find(
    ({ id }) => id === 'gagarin',
  );
  if (!afterReroute?.movement) throw new Error('Rover stopped during reroute');
  expect(afterReroute.route?.mode).toBe('FREE_NAVIGATION');
  expect(afterReroute.route?.originPosition).toEqual(
    afterReroute.movement.from,
  );
  expect(
    pointDistance(afterReroute.route!.originPosition, beforeReroutePosition),
  ).toBeLessThan(0.12);
  expect(
    pointDistance(afterReroute.route!.originPosition, beforeReroute.cell),
  ).toBeGreaterThan(0.05);
  expect(
    pointDistance(
      movementPosition(afterReroute.movement),
      beforeReroutePosition,
    ),
  ).toBeLessThan(0.16);
  expect(afterReroute.movement.progress).toBeLessThan(0.05);
  const newDirection = legDirection(afterReroute.route!.legs[0]!);
  expect(
    oldDirection.column * newDirection.column +
      oldDirection.row * newDirection.row,
  ).toBeLessThan(0);

  const initialWheelPhase = afterReroute.wheelPhase;
  await expect
    .poll(async () => {
      const rover = (await readMapState(page)).rovers.find(
        ({ id }) => id === 'gagarin',
      );
      return rover?.wheelPhase;
    })
    .not.toBe(initialWheelPhase);
  await expect
    .poll(async () => {
      const rover = (await readMapState(page)).rovers.find(
        ({ id }) => id === 'gagarin',
      );
      return rover?.dustVisibleCount ?? 0;
    })
    .toBe(3);
  await expect
    .poll(async () => {
      const rover = (await readMapState(page)).rovers.find(
        ({ id }) => id === 'gagarin',
      );
      if (!rover?.movement) return Number.POSITIVE_INFINITY;
      const direction = Math.atan2(
        rover.movement.to.row - rover.movement.from.row,
        rover.movement.to.column - rover.movement.from.column,
      );
      return angularDistance(rover.headingRadians, direction - Math.PI / 2);
    })
    .toBeLessThan(0.05);

  const beforeBlockedState = await clickCell(
    page,
    { column: 4, row: 4 },
    'right',
  );
  const beforeBlockedCell = beforeBlockedState.rovers.find(
    ({ id }) => id === 'gagarin',
  );
  if (!beforeBlockedCell?.movement || !beforeBlockedCell.route) {
    throw new Error('Rover stopped before blocked reroute');
  }
  const beforeBlockedPosition = movementPosition(beforeBlockedCell.movement);
  await expect(page.getByRole('alert')).toContainText(
    'Маршрут содержит недоступную клетку',
  );
  const afterBlockedCell = (await readMapState(page)).rovers.find(
    ({ id }) => id === 'gagarin',
  );
  expect(afterBlockedCell?.route).toEqual(beforeBlockedCell.route);
  expect(afterBlockedCell?.movement).toMatchObject({
    from: beforeBlockedCell.movement.from,
    to: beforeBlockedCell.movement.to,
  });
  expect(afterBlockedCell?.movement?.progress).toBeGreaterThanOrEqual(
    beforeBlockedCell.movement.progress,
  );
  expect(
    pointDistance(
      movementPosition(afterBlockedCell!.movement!),
      beforeBlockedPosition,
    ),
  ).toBeLessThan(0.12);

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const beforeZoom = await readMapState(page);
  await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.mouse.wheel(0, -360);
  await expect
    .poll(async () => (await readMapState(page)).camera.zoom)
    .toBeGreaterThan(beforeZoom.camera.zoom);

  const beforeMiddlePan = await readMapState(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(center.x - 100, center.y, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await expect
    .poll(async () => (await readMapState(page)).camera.center.x)
    .not.toBe(beforeMiddlePan.camera.center.x);

  health.assertClean();
});

test('reduced motion keeps heading but disables wheel and dust animation', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const health = watchPageHealth(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDispatcher(page, { scenario: 'routing-stable' });
  await expect
    .poll(async () => (await readMapState(page)).speechBubbles.length)
    .toBeGreaterThan(0);
  expect(await readMapState(page)).toMatchObject({
    reducedMotion: true,
    speechBubbles: expect.arrayContaining([
      expect.objectContaining({ transitioning: false, presentationScale: 1 }),
    ]),
  });
  await selectRover(page, 'gagarin');
  await clickCell(page, { column: 13, row: 8 }, 'right');

  await expect
    .poll(async () => {
      const rover = (await readMapState(page)).rovers.find(
        ({ id }) => id === 'gagarin',
      );
      if (!rover?.movement) return null;
      const direction = Math.atan2(
        rover.movement.to.row - rover.movement.from.row,
        rover.movement.to.column - rover.movement.from.column,
      );
      return {
        angleError: angularDistance(
          rover.headingRadians,
          direction - Math.PI / 2,
        ),
        dustVisibleCount: rover.dustVisibleCount,
        wheelPhase: rover.wheelPhase,
      };
    })
    .toEqual({ angleError: 0, dustVisibleCount: 0, wheelPhase: 0 });
  health.assertClean();
});

test('Тихо строит безопасный обход центральной зоны и публикует заявки центров', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const health = watchPageHealth(page);
  await startDispatcher(page, { levelName: 'Кратер Тихо' });
  await selectRover(page, 'armstrong');
  const selectedRover = (await readMapState(page)).rovers.find(
    ({ id }) => id === 'armstrong',
  );
  expect(selectedRover?.batteryRatio).toBeGreaterThan(0);
  expect(selectedRover?.cargoRatios).not.toBeNull();
  await clickCell(page, { column: 9, row: 6 }, 'right');

  await expect
    .poll(async () => {
      const rover = (await readMapState(page)).rovers.find(
        ({ id }) => id === 'armstrong',
      );
      return rover?.route?.mode;
    })
    .toBe('FREE_NAVIGATION');
  const route = (await readMapState(page)).rovers.find(
    ({ id }) => id === 'armstrong',
  )?.route;
  expect(route).toBeDefined();
  expect(route?.steps.at(-1)).toEqual({ column: 9, row: 6 });
  expect(route?.steps).toHaveLength(route?.legs.length ?? 0);
  expect(route?.legs.some(isDiagonalLeg)).toBe(true);
  expect(route?.forecast.lengthCells).toBeLessThan(12);
  expect(
    route?.legs
      .flatMap(({ traversals }) => traversals)
      .filter(
        ({ cell: { column, row } }) =>
          column >= 5 && column <= 7 && row >= 3 && row <= 5,
      ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Открыть рацию' }).click();
  const journal = page.getByRole('list', { name: 'Журнал сообщений' });
  await expect(journal.locator('.radio-message')).toHaveCount(2);
  await expect(
    journal.getByText(/Нам (нужен|нужны|нужно)/).first(),
  ).toBeVisible();
  health.assertClean();
});

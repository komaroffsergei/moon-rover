import { expect, type Page } from '@playwright/test';

export interface Cell {
  readonly column: number;
  readonly row: number;
}

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RouteTraversal {
  readonly cell: Cell;
  readonly distance: number;
  readonly startDistance: number;
  readonly endDistance: number;
  readonly entersCell: boolean;
}

export interface RouteLeg {
  readonly from: Cell;
  readonly to: Cell;
  readonly distance: number;
  readonly traversals: readonly RouteTraversal[];
}

export interface RouteState {
  readonly mode: 'LEGACY_CELL' | 'FREE_NAVIGATION';
  readonly origin: Cell;
  readonly originPosition: Cell;
  readonly steps: readonly Cell[];
  readonly legs: readonly RouteLeg[];
  readonly forecast: {
    readonly lengthCells: number;
    readonly gameMinutes: number;
    readonly batteryCost: number;
    readonly batteryRemaining: number;
    readonly risk: number;
  };
}

export interface MapState {
  readonly phase: string;
  readonly selectedEntity:
    | { readonly kind: 'base' }
    | { readonly kind: 'center' | 'rover'; readonly id: string }
    | null;
  readonly camera: {
    readonly center: { readonly x: number; readonly y: number };
    readonly zoom: number;
  };
  readonly reducedMotion: boolean;
  readonly hazardCells: readonly Cell[];
  readonly centers: readonly {
    readonly id: string;
    readonly cell: Cell;
    readonly status: string;
    readonly resources: {
      readonly oxygen: number;
      readonly food: number;
      readonly equipment: number;
    };
  }[];
  readonly speechQueueLength: number;
  readonly speechBubbles: readonly {
    readonly messageId: string;
    readonly eventCode: string;
    readonly objectId: string;
    readonly sourceKind: 'CENTER' | 'ROVER' | 'EMERGENCY';
    readonly text: string;
    readonly priority: number;
    readonly remainingMilliseconds: number;
    readonly transitioning: boolean;
    readonly presentationScale: number;
    readonly screenRect: ScreenRect;
    readonly closeScreenRect: ScreenRect;
    readonly anchorScreen: { readonly x: number; readonly y: number };
  }[];
  readonly rovers: readonly {
    readonly id: string;
    readonly cell: Cell;
    readonly position: Cell;
    readonly cargo: {
      readonly oxygen: number;
      readonly food: number;
      readonly equipment: number;
    };
    readonly movement: {
      readonly from: Cell;
      readonly to: Cell;
      readonly progress: number;
    } | null;
    readonly route: RouteState | null;
    readonly status: string;
    readonly batteryRatio: number;
    readonly cargoRatios: readonly [number, number, number] | null;
    readonly headingRadians: number;
    readonly wheelPhase: number;
    readonly dustVisibleCount: number;
    readonly world: { readonly x: number; readonly y: number };
  }[];
}

export interface PageHealth {
  assertClean(): void;
}

export interface StartDispatcherOptions {
  readonly levelName?: string;
  readonly scenario?: string;
  readonly placement?: 'procedural';
}

export function watchPageHealth(page: Page): PageHealth {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown error'}`,
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  return {
    assertClean() {
      expect(consoleErrors, 'console errors').toEqual([]);
      expect(pageErrors, 'page errors').toEqual([]);
      expect(failedRequests, 'failed requests').toEqual([]);
      expect(failedResponses, 'HTTP errors').toEqual([]);
    },
  };
}

export async function startDispatcher(
  page: Page,
  {
    levelName = 'Разлом Шеклтона',
    scenario,
    placement,
  }: StartDispatcherOptions = {},
): Promise<void> {
  const query = new URLSearchParams({ e2e: '1' });
  if (scenario !== undefined) query.set('scenario', scenario);
  if (placement !== undefined) query.set('placement', placement);
  await page.goto(`/?${query.toString()}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Выбор уровня' }),
  ).toBeVisible();
  await page.getByRole('button', { name: new RegExp(levelName, 'i') }).click();
  await page.getByRole('button', { name: 'Продолжить к брифингу' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Брифинг миссии' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Начать смену' }).click();

  const host = page.getByTestId('game-host');
  await expect(host).toHaveAttribute('data-map-ready', 'true', {
    timeout: 30_000,
  });
  await expect
    .poll(async () => (await readMapState(page)).phase)
    .toBe('RUNNING');
}

export async function readMapState(page: Page): Promise<MapState> {
  return page.getByTestId('game-host').evaluate((host) => {
    if (!host.dataset.mapState) throw new Error('Map state marker is absent');
    return JSON.parse(host.dataset.mapState) as MapState;
  });
}

export async function clickWorld(
  page: Page,
  world: { readonly x: number; readonly y: number },
  button: 'left' | 'right' = 'left',
): Promise<MapState> {
  const state = await readMapState(page);
  const canvas = page.getByTestId('game-host').locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');

  const position = {
    x: (world.x - state.camera.center.x) * state.camera.zoom + box.width / 2,
    y: (world.y - state.camera.center.y) * state.camera.zoom + box.height / 2,
  };
  await canvas.focus();
  await canvas.hover({ position });
  const beforeClick = await readMapState(page);
  await canvas.click({ position, button });
  return beforeClick;
}

export async function clickCell(
  page: Page,
  cell: Cell,
  button: 'left' | 'right' = 'left',
): Promise<MapState> {
  const state = await readMapState(page);
  const canvas = page.getByTestId('game-host').locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');

  const offsets = [
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.94 },
    { x: 0.06, y: 0.5 },
    { x: 0.94, y: 0.5 },
    { x: 0.06, y: 0.94 },
    { x: 0.94, y: 0.94 },
    { x: 0.06, y: 0.06 },
    { x: 0.94, y: 0.06 },
  ] as const;

  for (const offset of offsets) {
    const world = {
      x: (cell.column + offset.x) * 64,
      y: (cell.row + offset.y) * 64,
    };
    const screen = {
      x:
        box.x +
        (world.x - state.camera.center.x) * state.camera.zoom +
        box.width / 2,
      y:
        box.y +
        (world.y - state.camera.center.y) * state.camera.zoom +
        box.height / 2,
    };
    const canvasReceivesPointer = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS',
      screen,
    );
    if (canvasReceivesPointer) return clickWorld(page, world, button);
  }

  throw new Error(
    `Cell ${cell.column}:${cell.row} is fully covered by the game HUD`,
  );
}

export async function selectRover(page: Page, roverId: string): Promise<void> {
  const rover = (await readMapState(page)).rovers.find(
    ({ id }) => id === roverId,
  );
  if (!rover) throw new Error(`Unknown rover: ${roverId}`);

  await clickWorld(page, rover.world);
  await expect
    .poll(async () => (await readMapState(page)).selectedEntity)
    .toEqual({ kind: 'rover', id: roverId });
}

export async function selectCenter(
  page: Page,
  centerId: string,
): Promise<void> {
  const center = (await readMapState(page)).centers.find(
    ({ id }) => id === centerId,
  );
  if (!center) throw new Error(`Unknown center: ${centerId}`);

  await clickWorld(page, {
    x: (center.cell.column + 0.5) * 64 + 25,
    y: (center.cell.row + 0.5) * 64,
  });
  await expect
    .poll(async () => (await readMapState(page)).selectedEntity)
    .toEqual({ kind: 'center', id: centerId });
}

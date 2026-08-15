import { expect, test, type Page } from '@playwright/test';

import {
  readMapState,
  selectRover,
  startDispatcher,
  watchPageHealth,
} from './dispatcher-helpers';

interface RoverHudPixels {
  readonly cyanSelectionPixels: number;
  readonly resourceBands: number;
}

async function readRoverHudPixels(
  page: Page,
  roverId: string,
): Promise<RoverHudPixels> {
  const state = await readMapState(page);
  const rover = state.rovers.find(({ id }) => id === roverId);
  if (!rover) throw new Error(`Unknown rover: ${roverId}`);

  return page
    .getByTestId('game-host')
    .locator('canvas')
    .evaluate(
      (element, { camera, world }) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        if (!context)
          throw new Error('Phaser canvas 2D context is unavailable');
        const bounds = canvas.getBoundingClientRect();
        const scaleX = canvas.width / bounds.width;
        const scaleY = canvas.height / bounds.height;
        const centerX =
          ((world.x - camera.center.x) * camera.zoom + bounds.width / 2) *
          scaleX;
        const centerY =
          ((world.y - camera.center.y) * camera.zoom + bounds.height / 2) *
          scaleY;
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const sampled = new Set<string>();

        const rgbaAt = (x: number, y: number) => {
          const column = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
          const row = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
          const offset = (row * canvas.width + column) * 4;
          return {
            red: pixels[offset] ?? 0,
            green: pixels[offset + 1] ?? 0,
            blue: pixels[offset + 2] ?? 0,
            alpha: pixels[offset + 3] ?? 0,
          };
        };
        const isRouteCyan = ({
          red,
          green,
          blue,
          alpha,
        }: ReturnType<typeof rgbaAt>) =>
          alpha > 220 && blue > 180 && green - red > 55 && blue - red > 80;
        const isResourceColor = ({
          red,
          green,
          blue,
          alpha,
        }: ReturnType<typeof rgbaAt>) =>
          alpha > 220 &&
          Math.max(red, green, blue) > 140 &&
          Math.max(red, green, blue) - Math.min(red, green, blue) > 35;

        let cyanSelectionPixels = 0;
        for (const centerAngle of [0, Math.PI]) {
          for (let angleOffset = -18; angleOffset <= 18; angleOffset += 2) {
            const angle = centerAngle + (angleOffset * Math.PI) / 180;
            for (let radius = 31; radius <= 35; radius += 0.5) {
              const x =
                centerX + Math.cos(angle) * radius * camera.zoom * scaleX;
              const y =
                centerY + Math.sin(angle) * radius * camera.zoom * scaleY;
              const key = `${Math.round(x)}:${Math.round(y)}`;
              if (sampled.has(key)) continue;
              sampled.add(key);
              if (isRouteCyan(rgbaAt(x, y))) cyanSelectionPixels += 1;
            }
          }
        }

        const cargoLeft = Math.floor(centerX - 22 * camera.zoom * scaleX);
        const cargoRight = Math.ceil(centerX + 22 * camera.zoom * scaleX);
        const cargoTop = Math.floor(centerY - 52 * camera.zoom * scaleY);
        // Нижнюю границу отделяем от зелёного battery-ring: старые три строки
        // всё ещё попадают в диапазон, а круг батареи не становится четвёртой.
        const cargoBottom = Math.ceil(centerY - 32 * camera.zoom * scaleY);
        const coloredRows: number[] = [];
        for (let row = cargoTop; row <= cargoBottom; row += 1) {
          let coloredPixels = 0;
          for (let column = cargoLeft; column <= cargoRight; column += 1) {
            if (isResourceColor(rgbaAt(column, row))) coloredPixels += 1;
          }
          if (coloredPixels >= 4) coloredRows.push(row);
        }
        const resourceBands = coloredRows.reduce(
          (bands, row, index) =>
            index === 0 || row > coloredRows[index - 1]! + 1
              ? bands + 1
              : bands,
          0,
        );

        return { cyanSelectionPixels, resourceBands };
      },
      { camera: state.camera, world: rover.world },
    );
}

test('выбранный courier показывает только battery-ring и одну cargo-шкалу', async ({
  page,
}) => {
  const health = watchPageHealth(page);
  await startDispatcher(page, { levelName: 'Кратер Тихо' });
  await selectRover(page, 'armstrong');

  const state = await readMapState(page);
  const rover = state.rovers.find(({ id }) => id === 'armstrong');
  expect(rover?.batteryRatio).toBeGreaterThan(0);
  expect(rover?.cargoRatios).not.toBeNull();
  expect(
    rover?.cargoRatios?.reduce((total, ratio) => total + ratio, 0),
  ).toBeLessThanOrEqual(1);

  await expect
    .poll(() => readRoverHudPixels(page, 'armstrong'))
    .toEqual({ cyanSelectionPixels: 0, resourceBands: 1 });
  health.assertClean();
});

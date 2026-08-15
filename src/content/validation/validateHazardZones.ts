import {
  gridIndex,
  isInsideGrid,
  type GridPosition,
  type LogicalGrid,
} from './grid';
import type { ValidationIssue } from './issues';

const neighbors = (position: GridPosition): GridPosition[] => [
  { column: position.column + 1, row: position.row },
  { column: position.column - 1, row: position.row },
  { column: position.column, row: position.row + 1 },
  { column: position.column, row: position.row - 1 },
];

export function hazardZoneSizes(grid: LogicalGrid): number[] {
  const visited = new Set<number>();
  const sizes: number[] = [];

  grid.hazardous.forEach((hazardous, startIndex) => {
    if (
      !hazardous ||
      grid.blocked[startIndex] === true ||
      visited.has(startIndex)
    ) {
      return;
    }

    const queue: GridPosition[] = [
      {
        column: startIndex % grid.width,
        row: Math.floor(startIndex / grid.width),
      },
    ];
    visited.add(startIndex);
    let cursor = 0;

    while (cursor < queue.length) {
      const position = queue[cursor++];
      if (position === undefined) break;

      for (const neighbor of neighbors(position)) {
        if (!isInsideGrid(grid, neighbor)) continue;
        const index = gridIndex(grid, neighbor);
        if (
          grid.hazardous[index] !== true ||
          grid.blocked[index] === true ||
          visited.has(index)
        ) {
          continue;
        }
        visited.add(index);
        queue.push(neighbor);
      }
    }
    sizes.push(queue.length);
  });

  return sizes;
}

export function validateHazardZones(
  grid: LogicalGrid,
  levelOrdinal: number | undefined,
  hazardLayerIndex = 2,
): ValidationIssue[] {
  const sizes = hazardZoneSizes(grid);
  const issues: ValidationIssue[] = [];
  sizes.forEach((size, index) => {
    if (size < 8 || size > 30) {
      issues.push({
        code: 'map.hazard-zone-size',
        path: `$.layers[${hazardLayerIndex}].data`,
        message: `Hazard zone ${index} содержит ${size} клеток; ожидается 8–30`,
      });
    }
  });
  if (
    levelOrdinal !== undefined &&
    levelOrdinal >= 2 &&
    levelOrdinal <= 5 &&
    !sizes.some((size) => size >= 20)
  ) {
    issues.push({
      code: 'map.hazard-zone-large-missing',
      path: `$.layers[${hazardLayerIndex}].data`,
      message: `Level ${levelOrdinal} должен иметь hazard zone минимум из 20 клеток`,
    });
  }
  if (levelOrdinal === 5 && sizes.length < 3) {
    issues.push({
      code: 'map.hazard-zone-count',
      path: `$.layers[${hazardLayerIndex}].data`,
      message: `Level 5 должен иметь минимум 3 отдельные hazard zones; получено ${sizes.length}`,
    });
  }
  return issues;
}

import type { NavigationLeg, RouteForecast, RoutingMap } from '../../domain';
import { calculateCellBatteryCost } from '../battery/calculateBattery';
import { roundGameValue } from '../clock/fixedStepClock';
import { isRouteDraftValid, type RouteDraft } from './routeDraft';

export interface RouteForecastProfile {
  readonly gameMinutesPerNormalCell: number;
  readonly batteryCostMultiplier: number;
  readonly currentBattery: number;
  readonly firstStepProgress?: number;
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} должен быть конечным и неотрицательным`);
  }
}

export function calculateCellTravelGameMinutes(
  movementCost: number,
  gameMinutesPerNormalCell: number,
): number {
  assertNonNegativeFinite('movementCost', movementCost);
  assertNonNegativeFinite('gameMinutesPerNormalCell', gameMinutesPerNormalCell);
  const gameMinutes = movementCost * gameMinutesPerNormalCell;
  if (!Number.isFinite(gameMinutes)) {
    throw new RangeError('Время входа в клетку должно быть конечным');
  }
  return roundGameValue(gameMinutes);
}

export function forecastRoute(
  draft: RouteDraft,
  map: RoutingMap,
  profile: RouteForecastProfile,
): RouteForecast {
  if (!isRouteDraftValid(draft, map)) {
    throw new RangeError('Прогноз требует допустимый ручной маршрут');
  }
  assertNonNegativeFinite('currentBattery', profile.currentBattery);
  const firstStepProgress = profile.firstStepProgress ?? 0;
  if (
    !Number.isFinite(firstStepProgress) ||
    firstStepProgress < 0 ||
    firstStepProgress > 1
  ) {
    throw new RangeError('Прогресс первого шага должен быть от 0 до 1');
  }
  calculateCellTravelGameMinutes(0, profile.gameMinutesPerNormalCell);
  calculateCellBatteryCost(0, profile.batteryCostMultiplier);

  let gameMinutes = 0;
  let batteryCost = 0;
  let noIncidentChance = 1;

  for (const [index, step] of draft.steps.entries()) {
    const cell = map.cells[step.row * map.width + step.column];
    if (!cell) {
      throw new RangeError('Маршрут содержит клетку за границами карты');
    }
    if (
      !Number.isFinite(cell.effectiveCellChance) ||
      cell.effectiveCellChance < 0 ||
      cell.effectiveCellChance > 1
    ) {
      throw new RangeError('Вероятность происшествия должна быть от 0 до 1');
    }

    const fullStepGameMinutes = calculateCellTravelGameMinutes(
      cell.movementCost,
      profile.gameMinutesPerNormalCell,
    );
    gameMinutes = roundGameValue(
      gameMinutes +
        fullStepGameMinutes * (index === 0 ? 1 - firstStepProgress : 1),
    );
    batteryCost += calculateCellBatteryCost(
      cell.movementCost,
      profile.batteryCostMultiplier,
    );
    noIncidentChance *= 1 - cell.effectiveCellChance;
  }

  return {
    lengthCells: draft.steps.length,
    gameMinutes,
    batteryCost,
    batteryRemaining: Math.max(0, profile.currentBattery - batteryCost),
    risk: Math.min(1, Math.max(0, 1 - noIncidentChance)),
  };
}

export function forecastNavigationRoute(
  legs: readonly NavigationLeg[],
  map: RoutingMap,
  profile: RouteForecastProfile,
): RouteForecast {
  assertNonNegativeFinite('currentBattery', profile.currentBattery);
  calculateCellTravelGameMinutes(0, profile.gameMinutesPerNormalCell);
  calculateCellBatteryCost(0, profile.batteryCostMultiplier);

  let lengthCells = 0;
  let gameMinutes = 0;
  let batteryCost = 0;
  let noIncidentChance = 1;

  for (const leg of legs) {
    lengthCells += leg.distance;
    for (const traversal of leg.traversals) {
      const cell =
        map.cells[traversal.cell.row * map.width + traversal.cell.column];
      if (cell === undefined || cell.walkable !== true) {
        throw new RangeError('Навигационный маршрут вышел за walkable-карту');
      }
      const terrainDistance = traversal.distance * cell.movementCost;
      gameMinutes = roundGameValue(
        gameMinutes +
          calculateCellTravelGameMinutes(
            terrainDistance,
            profile.gameMinutesPerNormalCell,
          ),
      );
      batteryCost += calculateCellBatteryCost(
        terrainDistance,
        profile.batteryCostMultiplier,
      );
      if (traversal.entersCell) {
        noIncidentChance *= 1 - cell.effectiveCellChance;
      }
    }
  }

  return Object.freeze({
    lengthCells: roundGameValue(lengthCells),
    gameMinutes,
    batteryCost,
    batteryRemaining: Math.max(0, profile.currentBattery - batteryCost),
    risk: Math.min(1, Math.max(0, 1 - noIncidentChance)),
  });
}

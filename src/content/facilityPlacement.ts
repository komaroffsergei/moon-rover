import { uniformInt } from 'pure-rand/distribution/uniformInt';

import type { GridCell, RoutingMap } from '../domain';
import { createSeededRandom } from '../shared/random/seededRandom';
import { createRoutingMapFromContent } from './createRoutingMap';
import type { IncidentProfiles } from './schemas/incidents';
import type { LevelMeta } from './schemas/levelMeta';
import type { TiledMap } from './schemas/tiled';
import { navigationDistancesFrom, type LogicalGrid } from './validation/grid';

export interface FacilityPlacement {
  readonly mode: 'procedural' | 'authoring';
  /** Authoring layout that supplied the safe base (and all facilities in E2E). */
  readonly layoutId: string;
  readonly baseCell: GridCell;
  readonly centers: Readonly<Record<string, GridCell>>;
}

export interface FacilityPlacementContent {
  readonly balance: {
    readonly incidents: {
      readonly normalCellChance: number;
    };
  };
  readonly incidents: IncidentProfiles;
  readonly levelMeta: LevelMeta;
  readonly map: TiledMap;
}

export interface FacilityPlacementOptions {
  /** Pins validated authoring coordinates for coordinate-based E2E scenarios. */
  readonly authoringLayoutId?: string;
}

const reachabilityGrids = new WeakMap<TiledMap, LogicalGrid>();

function cloneAuthoringPlacement(
  level: LevelMeta,
  layoutId: string,
): FacilityPlacement {
  const layout = level.facilityLayouts.find(({ id }) => id === layoutId);
  if (layout === undefined) {
    throw new RangeError(
      `Validated level ${level.id} не содержит authoring layout ${layoutId}`,
    );
  }
  return {
    mode: 'authoring',
    layoutId: layout.id,
    baseCell: { ...layout.baseCell },
    centers: Object.fromEntries(
      Object.entries(layout.centers).map(([centerId, cell]) => [
        centerId,
        { ...cell },
      ]),
    ),
  };
}

function reachabilityGrid(source: TiledMap, map: RoutingMap): LogicalGrid {
  const cached = reachabilityGrids.get(source);
  if (cached !== undefined) return cached;

  const grid = {
    width: map.width,
    height: map.height,
    blocked: map.cells.map(({ walkable }) => !walkable),
    hazardous: Array<boolean>(map.cells.length).fill(false),
  };
  reachabilityGrids.set(source, grid);
  return grid;
}

/**
 * Выбирает валидированную безопасную authoring-базу, затем процедурно
 * размещает центры. RNG размещения изолирован от RNG симуляции.
 */
export function selectFacilityPlacement(
  content: FacilityPlacementContent,
  placementSeed: string,
  options: FacilityPlacementOptions = {},
): FacilityPlacement {
  if (placementSeed.length === 0) {
    throw new RangeError('placementSeed не должен быть пустым');
  }

  const { levelMeta: level } = content;
  if (options.authoringLayoutId !== undefined) {
    return cloneAuthoringPlacement(level, options.authoringLayoutId);
  }

  const layouts = [...level.facilityLayouts].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const random = createSeededRandom(
    level.id,
    'facility-placement-v2',
    placementSeed,
  );
  const selected = layouts[uniformInt(random, 0, layouts.length - 1)];
  if (selected === undefined) {
    throw new Error(`Validated level ${level.id} не содержит facility layouts`);
  }

  const routingMap = createRoutingMapFromContent({
    map: content.map,
    incidents: content.incidents,
    normalCellChance: content.balance.incidents.normalCellChance,
  });
  const grid = reachabilityGrid(content.map, routingMap);
  const distances = navigationDistancesFrom(grid, selected.baseCell);
  const baseIndex =
    selected.baseCell.row * routingMap.width + selected.baseCell.column;
  const candidates: GridCell[] = [];
  for (let row = 1; row < routingMap.height - 1; row += 1) {
    for (let column = 1; column < routingMap.width - 1; column += 1) {
      const index = row * routingMap.width + column;
      if (
        index !== baseIndex &&
        distances[index] !== undefined &&
        routingMap.cells[index]?.walkable === true
      ) {
        candidates.push({ column, row });
      }
    }
  }

  const centerIds = level.centers.map(({ id }) => id).sort();
  if (candidates.length < centerIds.length) {
    throw new RangeError(
      `Level ${level.id} содержит ${candidates.length} reachable interior cells для ${centerIds.length} centers`,
    );
  }
  for (let end = candidates.length - 1; end > 0; end -= 1) {
    const selectedIndex = uniformInt(random, 0, end);
    [candidates[end], candidates[selectedIndex]] = [
      candidates[selectedIndex]!,
      candidates[end]!,
    ];
  }

  return {
    mode: 'procedural',
    layoutId: selected.id,
    baseCell: { ...selected.baseCell },
    centers: Object.fromEntries(
      centerIds.map((centerId, index) => [centerId, candidates[index]!]),
    ),
  };
}

import type { LevelMeta } from '../schemas/levelMeta';
import type { TiledObject } from '../schemas/tiled';
import {
  distancesFrom,
  gridIndex,
  isInsideGrid,
  navigationDistancesFrom,
  safePathMultiplicity,
  type GridPosition,
} from './grid';
import type { ValidationIssue } from './issues';
import type { TiledValidationModel } from './validateTiledStructure';

interface LocatedObject {
  entityId: string;
  index: number;
  object: TiledObject;
  path: string;
  position: GridPosition;
}

const objectClasses = new Set(['base', 'center', 'roverSpawn', 'repairSpawn']);

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function entityIdOf(object: TiledObject): string | undefined {
  const matches = (object.properties ?? []).filter(
    ({ name }) => name === 'entityId',
  );
  return matches.length === 1 && typeof matches[0]?.value === 'string'
    ? matches[0].value
    : undefined;
}

function validateObject(
  object: TiledObject,
  index: number,
  model: TiledValidationModel,
  issues: ValidationIssue[],
): LocatedObject | undefined {
  const path = `$.layers[${model.objectLayerIndex}].objects[${index}]`;
  if (object.type !== undefined && object.type !== '') {
    issues.push(
      issue(
        'map.object-legacy-type',
        `${path}.type`,
        'Legacy object.type нельзя использовать для доменной классификации',
      ),
    );
  }
  if (object.class === undefined || !objectClasses.has(object.class)) {
    issues.push(
      issue(
        'map.object-class',
        `${path}.class`,
        'Object class должен быть base, center, roverSpawn или repairSpawn',
      ),
    );
    return undefined;
  }
  if (object.point !== true) {
    issues.push(
      issue(
        'map.object-shape',
        `${path}.point`,
        'Доменные объекты должны быть point objects',
      ),
    );
  }
  const objectFields = object as Record<string, unknown>;
  const forbiddenShape = ['polygon', 'polyline', 'ellipse', 'text'].find(
    (field) => field in objectFields,
  );
  if (forbiddenShape !== undefined) {
    issues.push(
      issue(
        'map.object-shape',
        `${path}.${forbiddenShape}`,
        'Навигационные polygon/polyline и другие shapes запрещены',
      ),
    );
  }

  const properties = object.properties ?? [];
  if (properties.some(({ name }) => name !== 'entityId')) {
    issues.push(
      issue(
        'map.object-property',
        `${path}.properties`,
        'Object properties могут содержать только entityId',
      ),
    );
  }
  const entityId = entityIdOf(object);
  if (entityId === undefined) {
    issues.push(
      issue(
        'map.object-id',
        `${path}.properties`,
        'Нужен ровно один строковый entityId',
      ),
    );
    return undefined;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entityId)) {
    issues.push(
      issue(
        'map.object-id',
        `${path}.properties`,
        'entityId должен быть в kebab-case',
      ),
    );
  }

  if (!Number.isInteger(object.x / 64) || !Number.isInteger(object.y / 64)) {
    issues.push(
      issue(
        'map.object-grid-position',
        path,
        'Object должен находиться на целой клетке 64×64',
      ),
    );
    return undefined;
  }
  const position = { column: object.x / 64, row: object.y / 64 };
  if (!isInsideGrid(model.grid, position)) {
    issues.push(
      issue('map.object-outside', path, 'Object находится за границами карты'),
    );
    return undefined;
  }
  if (model.grid.blocked[gridIndex(model.grid, position)] === true) {
    issues.push(
      issue(
        'map.object-blocked',
        path,
        `Object ${entityId} находится на blocked клетке`,
      ),
    );
  }

  return { entityId, index, object, path, position };
}

function validateCounts(
  objects: LocatedObject[],
  objectLayerIndex: number,
  issues: ValidationIssue[],
): void {
  const count = (className: string) =>
    objects.filter(({ object }) => object.class === className).length;
  const requirements: Array<[string, number, number]> = [
    ['base', 1, 1],
    ['center', 1, Number.POSITIVE_INFINITY],
    ['roverSpawn', 1, Number.POSITIVE_INFINITY],
    ['repairSpawn', 1, 1],
  ];

  for (const [className, minimum, maximum] of requirements) {
    const actual = count(className);
    if (actual < minimum || actual > maximum) {
      issues.push(
        issue(
          'map.object-count',
          `$.layers[${objectLayerIndex}].objects`,
          `Ожидалось ${minimum === maximum ? minimum : `не менее ${minimum}`} object class=${className}, получено ${actual}`,
        ),
      );
    }
  }
}

function validateCenterPositions(
  objects: LocatedObject[],
  issues: ValidationIssue[],
): void {
  const base = objects.find(({ object }) => object.class === 'base');
  const centerByPosition = new Map<string, LocatedObject>();

  for (const center of objects.filter(
    ({ object }) => object.class === 'center',
  )) {
    if (
      base !== undefined &&
      center.position.column === base.position.column &&
      center.position.row === base.position.row
    ) {
      issues.push(
        issue(
          'map.base-center-overlap',
          center.path,
          `Center ${center.entityId} не может находиться на клетке базы`,
        ),
      );
    }

    const positionKey = `${center.position.column}:${center.position.row}`;
    const firstCenter = centerByPosition.get(positionKey);
    if (firstCenter !== undefined) {
      issues.push(
        issue(
          'map.center-overlap',
          center.path,
          `Center ${center.entityId} не может совпадать с center ${firstCenter.entityId}`,
        ),
      );
    } else {
      centerByPosition.set(positionKey, center);
    }
  }
}

function validateLevelReferences(
  objects: LocatedObject[],
  level: LevelMeta,
  issues: ValidationIssue[],
): void {
  const byEntityId = new Map(objects.map((item) => [item.entityId, item]));
  const centerIds = new Set(level.centers.map(({ id }) => id));

  for (const object of objects.filter(
    ({ object: value }) => value.class === 'center',
  )) {
    if (!centerIds.has(object.entityId)) {
      issues.push(
        issue(
          'map.center-reference',
          object.path,
          `Center ${object.entityId} отсутствует в level meta`,
        ),
      );
    }
  }
  for (const center of level.centers) {
    if (byEntityId.get(center.id)?.object.class !== 'center') {
      issues.push(
        issue(
          'map.center-reference',
          '$.levelMeta.centers',
          `Center ${center.id} отсутствует в Tiled objects`,
        ),
      );
    }
  }

  for (const rover of level.rovers) {
    const spawn = byEntityId.get(rover.spawnObjectId);
    const expectedClass =
      rover.archetypeId === 'repair' ? 'repairSpawn' : 'roverSpawn';
    if (spawn?.object.class !== expectedClass) {
      issues.push(
        issue(
          'map.spawn-reference',
          '$.levelMeta.rovers',
          `Spawn ${rover.spawnObjectId} должен иметь class=${expectedClass}`,
        ),
      );
    }
  }
  const spawnIds = new Set(
    level.rovers.map(({ spawnObjectId }) => spawnObjectId),
  );
  for (const spawn of objects.filter(({ object }) =>
    ['roverSpawn', 'repairSpawn'].includes(object.class ?? ''),
  )) {
    if (!spawnIds.has(spawn.entityId)) {
      issues.push(
        issue(
          'map.spawn-reference',
          spawn.path,
          `Spawn ${spawn.entityId} отсутствует в level meta`,
        ),
      );
    }
  }
}

function validateReachability(
  objects: LocatedObject[],
  model: TiledValidationModel,
  issues: ValidationIssue[],
): void {
  const base = objects.find(({ object }) => object.class === 'base');
  if (base === undefined) return;

  const distances = navigationDistancesFrom(model.grid, base.position);
  for (const object of objects.filter(
    ({ object: value }) => value.class !== 'base',
  )) {
    if (distances[gridIndex(model.grid, object.position)] === undefined) {
      issues.push(
        issue(
          'map.unreachable',
          object.path,
          `Object ${object.entityId} недостижим от базы`,
        ),
      );
    }
  }

  const isolatedIndex = model.grid.blocked.findIndex(
    (blocked, index) => !blocked && distances[index] === undefined,
  );
  if (isolatedIndex >= 0) {
    issues.push(
      issue(
        'map.isolated-cell',
        `$.layers[${model.terrainLayerIndex}].data[${isolatedIndex}]`,
        'Walkable клетка изолирована от базы',
      ),
    );
  }
}

function validateRiskChoices(
  objects: LocatedObject[],
  model: TiledValidationModel,
  level: LevelMeta,
  issues: ValidationIssue[],
  paths: {
    readonly riskChoice?: (centerId: string, index: number) => string;
    readonly centers?: string;
  } = {},
): void {
  const base = objects.find(({ object }) => object.class === 'base');
  if (base === undefined) return;

  const unrestricted = distancesFrom(model.grid, base.position);
  const safe = distancesFrom(model.grid, base.position, true);
  const byEntityId = new Map(objects.map((item) => [item.entityId, item]));

  level.riskChoiceCenters.forEach((centerId, index) => {
    const center = byEntityId.get(centerId);
    if (center?.object.class !== 'center') return;

    const cellIndex = gridIndex(model.grid, center.position);
    const shortDistance = unrestricted[cellIndex];
    const safeDistance = safe[cellIndex];
    const path =
      paths.riskChoice?.(centerId, index) ??
      `$.levelMeta.riskChoiceCenters[${index}]`;
    if (shortDistance === undefined) return;
    if (safeDistance === undefined) {
      issues.push(
        issue(
          'map.risk-safe-path',
          path,
          `Для ${centerId} отсутствует безопасный путь`,
        ),
      );
      return;
    }
    if (safeDistance <= shortDistance) {
      issues.push(
        issue(
          'map.risk-shortcut',
          path,
          `Кратчайший путь к ${centerId} не требует hazard`,
        ),
      );
      return;
    }

    const ratio = safeDistance / shortDistance;
    if (ratio < 1.4 || ratio > 1.9) {
      issues.push(
        issue(
          'map.risk-ratio',
          path,
          `Safe/short ratio ${ratio.toFixed(2)} вне диапазона 1.4–1.9`,
        ),
      );
    }
  });

  if (level.ordinal < 2) return;

  const riskChoiceCenterIds = new Set(level.riskChoiceCenters);
  const hasDirectSafeCenter = level.centers.some((definition) => {
    if (riskChoiceCenterIds.has(definition.id)) return false;
    const center = byEntityId.get(definition.id);
    if (center?.object.class !== 'center') return false;
    const cellIndex = gridIndex(model.grid, center.position);
    const shortDistance = unrestricted[cellIndex];
    return shortDistance !== undefined && safe[cellIndex] === shortDistance;
  });
  if (!hasDirectSafeCenter) {
    issues.push(
      issue(
        'map.direct-safe-center',
        paths.centers ?? '$.levelMeta.centers',
        'Минимум один non-risk центр должен иметь прямой безопасный путь',
      ),
    );
  }

  if (
    !level.centers.some((definition) => {
      const center = byEntityId.get(definition.id);
      return (
        center?.object.class === 'center' &&
        safePathMultiplicity(model.grid, base.position, center.position) >= 2
      );
    })
  ) {
    issues.push(
      issue(
        'map.safe-approaches',
        paths.centers ?? '$.levelMeta.centers',
        'Минимум один центр должен иметь два независимых безопасных подхода',
      ),
    );
  }
}

function validateFacilityLayouts(
  objects: LocatedObject[],
  model: TiledValidationModel,
  level: LevelMeta,
  issues: ValidationIssue[],
): void {
  const baseTemplate = objects.find(({ object }) => object.class === 'base');
  const centerTemplates = new Map(
    objects
      .filter(({ object }) => object.class === 'center')
      .map((center) => [center.entityId, center]),
  );
  if (baseTemplate === undefined) return;

  level.facilityLayouts.forEach((layout, layoutIndex) => {
    const layoutPath = `$.levelMeta.facilityLayouts[${layoutIndex}]`;
    const facilities = [
      { id: 'base', path: `${layoutPath}.baseCell`, cell: layout.baseCell },
      ...Object.entries(layout.centers).map(([id, cell]) => ({
        id,
        path: `${layoutPath}.centers.${id}`,
        cell,
      })),
    ];
    let cellsAreValid = true;
    for (const facility of facilities) {
      if (!isInsideGrid(model.grid, facility.cell)) {
        cellsAreValid = false;
        issues.push(
          issue(
            'map.facility-outside',
            facility.path,
            `${facility.id} находится за границами карты`,
          ),
        );
        continue;
      }
      const index = gridIndex(model.grid, facility.cell);
      if (model.grid.blocked[index] === true) {
        cellsAreValid = false;
        issues.push(
          issue(
            'map.facility-blocked',
            facility.path,
            `${facility.id} находится на blocked клетке`,
          ),
        );
      }
      if (model.grid.hazardous[index] === true) {
        cellsAreValid = false;
        issues.push(
          issue(
            'map.facility-hazard',
            facility.path,
            `${facility.id} должен находиться на безопасной клетке`,
          ),
        );
      }
    }
    if (!cellsAreValid) return;

    const reachable = navigationDistancesFrom(model.grid, layout.baseCell);
    let proceduralCandidateCount = 0;
    for (let row = 1; row < model.grid.height - 1; row += 1) {
      for (let column = 1; column < model.grid.width - 1; column += 1) {
        const cell = { column, row };
        const index = gridIndex(model.grid, cell);
        if (
          model.grid.blocked[index] !== true &&
          reachable[index] !== undefined &&
          (column !== layout.baseCell.column || row !== layout.baseCell.row)
        ) {
          proceduralCandidateCount += 1;
        }
      }
    }
    if (proceduralCandidateCount < level.centers.length) {
      issues.push(
        issue(
          'map.procedural-center-capacity',
          `${layoutPath}.baseCell`,
          `От базы доступны ${proceduralCandidateCount} внутренних клеток для ${level.centers.length} процедурных центров`,
        ),
      );
    }

    const safeDistances = navigationDistancesFrom(
      model.grid,
      layout.baseCell,
      true,
    );
    Object.entries(layout.centers).forEach(([centerId, cell]) => {
      if (safeDistances[gridIndex(model.grid, cell)] === undefined) {
        issues.push(
          issue(
            'map.facility-unreachable',
            `${layoutPath}.centers.${centerId}`,
            `${centerId} недостижим от базы безопасным маршрутом`,
          ),
        );
      }
    });

    const layoutObjects: LocatedObject[] = [
      {
        ...baseTemplate,
        path: `${layoutPath}.baseCell`,
        position: layout.baseCell,
      },
      ...Object.entries(layout.centers).flatMap(([centerId, position]) => {
        const template = centerTemplates.get(centerId);
        return template === undefined
          ? []
          : [
              {
                ...template,
                path: `${layoutPath}.centers.${centerId}`,
                position,
              },
            ];
      }),
    ];
    validateRiskChoices(layoutObjects, model, level, issues, {
      riskChoice: (centerId) => `${layoutPath}.centers.${centerId}`,
      centers: `${layoutPath}.centers`,
    });
  });
}

export function validateTiledWorld(
  model: TiledValidationModel,
  level?: LevelMeta,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if ((model.objectLayer.properties?.length ?? 0) > 0) {
    issues.push(
      issue(
        'map.layer-property',
        `$.layers[${model.objectLayerIndex}].properties`,
        'Игровые коэффициенты в properties objects layer запрещены',
      ),
    );
  }

  const seenObjectIds = new Map<number, number>();
  const seenEntityIds = new Map<string, number>();
  const objects: LocatedObject[] = [];
  model.objectLayer.objects.forEach((object, index) => {
    const path = `$.layers[${model.objectLayerIndex}].objects[${index}]`;
    const firstObjectIndex = seenObjectIds.get(object.id);
    if (firstObjectIndex !== undefined) {
      issues.push(
        issue(
          'map.duplicate-object-id',
          `${path}.id`,
          `Tiled object id уже используется в object ${firstObjectIndex}`,
        ),
      );
    } else {
      seenObjectIds.set(object.id, index);
    }

    const located = validateObject(object, index, model, issues);
    if (located === undefined) return;

    const firstEntityIndex = seenEntityIds.get(located.entityId);
    if (firstEntityIndex !== undefined) {
      issues.push(
        issue(
          'map.duplicate-entity-id',
          `${path}.properties`,
          `entityId уже используется в object ${firstEntityIndex}`,
        ),
      );
    } else {
      seenEntityIds.set(located.entityId, index);
    }
    objects.push(located);
  });

  validateCounts(objects, model.objectLayerIndex, issues);
  validateCenterPositions(objects, issues);
  const base = objects.find(({ object }) => object.class === 'base');
  if (base !== undefined && base.entityId !== 'base') {
    issues.push(
      issue('map.base-id', base.path, 'Base object должен иметь entityId=base'),
    );
  }
  if (level !== undefined) validateLevelReferences(objects, level, issues);
  validateReachability(objects, model, issues);
  if (level !== undefined) {
    validateRiskChoices(objects, model, level, issues);
    validateFacilityLayouts(objects, model, level, issues);
  }

  return issues;
}

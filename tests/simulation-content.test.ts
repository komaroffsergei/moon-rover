import { describe, expect, it } from 'vitest';

import {
  createSimulationConfigFromContent,
  loadContentBundle,
  selectFacilityPlacement,
} from '../src/content';
import { createSimulationEngine } from '../src/simulation';
import {
  balanceFixture,
  incidentsFixture,
  levelMetaFixture,
  makeBundleFixture,
  makeValidTiledMap,
  radioFixture,
} from './fixtures/content';

type SimulationContent = Parameters<
  typeof createSimulationConfigFromContent
>[0];

function createConfig(content: SimulationContent) {
  return createSimulationConfigFromContent(
    content,
    selectFacilityPlacement(content, 'simulation-content'),
  );
}

describe('simulation content adapter', () => {
  it('constructs an engine from a validated raw content bundle', () => {
    const raw = JSON.parse(JSON.stringify(makeBundleFixture())) as ReturnType<
      typeof makeBundleFixture
    >;
    const content = loadContentBundle(raw);
    const placement = selectFacilityPlacement(content, 'simulation-content');
    const config = createSimulationConfigFromContent(content, placement);

    expect(config).toMatchObject({
      seed: levelMetaFixture.seed,
      time: balanceFixture.time,
      routeWeights: balanceFixture.routing.routeWeights,
      centerRules: {
        recoveryRadioThresholds: balanceFixture.center.recoveryRadioThresholds,
      },
      equipmentDemand: balanceFixture.center.equipmentDemand,
      equipmentDemandCenterIds: levelMetaFixture.seededEquipmentDemandCenterIds,
      rescueRules: balanceFixture.rescue,
      radioCatalog: {
        historyLimit: radioFixture.historyLimit,
        messages: radioFixture.messages,
      },
    });
    expect(config.routingMap).toMatchObject({ width: 5, height: 3 });
    expect(config.routingMap.cells[0]).toEqual({
      walkable: true,
      movementCost: 1,
      effectiveCellChance: balanceFixture.incidents.normalCellChance,
      incidentProfileId: 'normal',
    });
    expect(config.routingMap.cells[7]).toEqual({
      walkable: true,
      movementCost: 1,
      effectiveCellChance: incidentsFixture.profiles.find(
        ({ id }) => id === 'hazard-low',
      )!.cellChance,
      incidentProfileId: 'hazard-low',
    });
    expect(config.incidentRules).toEqual({
      eventCooldownCells: balanceFixture.routing.eventCooldownCells,
      dustStormGameMinutes: content.incidents.rules.dustStormGameMinutes,
      selfRepairGameMinutes: content.incidents.rules.selfRepairGameMinutes,
      profiles: incidentsFixture.profiles,
    });
    expect(config.centers[0]).toMatchObject({
      id: levelMetaFixture.centers[0]!.id,
      equipmentCapacity: 100,
      cell: placement.centers[levelMetaFixture.centers[0]!.id],
    });
    expect(config).toMatchObject({
      baseCell: placement.baseCell,
      rovers: [
        {
          id: 'rover-one',
          archetypeId: 'standard',
          kind: 'courier',
          initialCell: placement.baseCell,
          cargoCapacity: 60,
          batteryCapacity: 100,
          batteryInitial: 100,
          initialCargo: { oxygen: 20, food: 20, equipment: 20 },
        },
        {
          id: 'rover-two',
          initialCell: placement.baseCell,
        },
        {
          id: 'rover-repair',
          kind: 'repair',
          cargoCapacity: 0,
          initialCell: placement.baseCell,
        },
      ],
    });
    expect(() => createSimulationEngine(config)).not.toThrow();
  });

  it('uses changed validated archetype coefficients instead of matching literals', () => {
    const balance = structuredClone(balanceFixture);
    const standard = balance.roverArchetypes.find(
      ({ id }) => id === 'standard',
    )!;
    standard.cargoCapacity = 73;
    standard.batteryCapacity = 117;
    standard.gameMinutesPerNormalCell = 3.25;
    standard.batteryCostMultiplier = 1.35;

    const config = createConfig({
      balance,
      incidents: incidentsFixture,
      levelMeta: levelMetaFixture,
      map: makeValidTiledMap(),
      radio: radioFixture,
    });

    expect(config.rovers.find(({ id }) => id === 'rover-one')).toMatchObject({
      cargoCapacity: 73,
      batteryCapacity: 117,
      batteryInitial: 117,
      gameMinutesPerNormalCell: 3.25,
      batteryCostMultiplier: 1.35,
      initialCargo: { oxygen: 25, food: 24, equipment: 24 },
    });
  });

  it('copies changed validated route weights instead of matching literals', () => {
    const balance = structuredClone(balanceFixture);
    balance.routing.routeWeights = { movementCost: 2.5, incidentRisk: 6 };

    const config = createConfig({
      balance,
      incidents: incidentsFixture,
      levelMeta: levelMetaFixture,
      map: makeValidTiledMap(),
      radio: radioFixture,
    });

    expect(config.routeWeights).toEqual({
      movementCost: 2.5,
      incidentRisk: 6,
    });
  });

  it('derives walkability, movement cost and risk from validated runtime content', () => {
    const balance = structuredClone(balanceFixture);
    const incidents = structuredClone(incidentsFixture);
    const map = makeValidTiledMap();
    const terrain = map.layers.find(({ name }) => name === 'terrain');
    const hazards = map.layers.find(({ name }) => name === 'hazards');
    const obstacles = map.layers.find(({ name }) => name === 'obstacles');
    if (
      terrain?.type !== 'tilelayer' ||
      hazards?.type !== 'tilelayer' ||
      obstacles?.type !== 'tilelayer'
    ) {
      throw new Error('Fixture layers are missing');
    }
    balance.incidents.normalCellChance = 0.009;
    incidents.profiles.find(({ id }) => id === 'normal')!.cellChance = 0.009;
    incidents.profiles.find(({ id }) => id === 'hazard-low')!.cellChance = 0.13;
    terrain.data[1] = 2;
    hazards.data[1] = 0;
    hazards.data[3] = 0x80000000 + 2;
    obstacles.data[2] = 3;
    obstacles.data[4] = 0x80000000;

    const config = createConfig({
      balance,
      incidents,
      levelMeta: levelMetaFixture,
      map,
      radio: radioFixture,
    });

    expect(config.routingMap.cells[1]).toEqual({
      walkable: true,
      movementCost: 1.5,
      effectiveCellChance: 0.009,
      incidentProfileId: 'normal',
    });
    expect(config.routingMap.cells[2]!.walkable).toBe(false);
    expect(config.routingMap.cells[3]).toMatchObject({
      effectiveCellChance: 0.13,
      incidentProfileId: 'hazard-low',
    });
    expect(config.routingMap.cells[4]!.walkable).toBe(true);
  });

  it('copies incident weights from runtime content', () => {
    const incidents = structuredClone(incidentsFixture);
    incidents.profiles.find(({ id }) => id === 'normal')!.weights = {
      dustStorm: 1,
      meteorite: 7,
      crater: 2,
    };
    incidents.profiles.find(({ id }) => id === 'hazard-low')!.weights = {
      dustStorm: 3,
      meteorite: 2,
      crater: 5,
    };
    const config = createConfig({
      balance: balanceFixture,
      incidents,
      levelMeta: levelMetaFixture,
      map: makeValidTiledMap(),
      radio: radioFixture,
    });

    expect(config.incidentRules).toEqual({
      eventCooldownCells: balanceFixture.routing.eventCooldownCells,
      dustStormGameMinutes: incidents.rules.dustStormGameMinutes,
      selfRepairGameMinutes: incidents.rules.selfRepairGameMinutes,
      profiles: incidents.profiles,
    });
  });

  it('resolves global tile IDs without assuming firstgid equals one', () => {
    const map = makeValidTiledMap();
    map.tilesets[0]!.firstgid = 11;
    for (const layer of map.layers) {
      if (layer.type !== 'tilelayer') continue;
      layer.data = layer.data.map((gid) => (gid === 0 ? 0 : gid + 10));
    }

    const config = createConfig({
      balance: balanceFixture,
      incidents: incidentsFixture,
      levelMeta: levelMetaFixture,
      map,
      radio: radioFixture,
    });

    expect(config.routingMap.cells[0]).toMatchObject({
      walkable: true,
      movementCost: 1,
    });
    expect(config.routingMap.cells[7]!.effectiveCellChance).toBe(
      incidentsFixture.profiles.find(({ id }) => id === 'hazard-low')!
        .cellChance,
    );
  });
});

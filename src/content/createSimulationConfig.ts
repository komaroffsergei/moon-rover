import type { SimulationConfig } from '../domain';
import { createRoutingMapFromContent } from './createRoutingMap';
import type { Balance } from './schemas/balance';
import type { IncidentProfiles } from './schemas/incidents';
import type { LevelMeta } from './schemas/levelMeta';
import type { RadioContent } from './schemas/radio';
import type { TiledMap } from './schemas/tiled';
import type { FacilityPlacement } from './facilityPlacement';

export interface SimulationContent {
  balance: Balance;
  incidents: IncidentProfiles;
  levelMeta: LevelMeta;
  map: TiledMap;
  radio: RadioContent;
}

function requiredCenterCell(placement: FacilityPlacement, centerId: string) {
  const cell = placement.centers[centerId];
  if (cell === undefined) {
    throw new Error(`Validated placement не содержит center ${centerId}`);
  }
  return { ...cell };
}

/** База выдаёт курьеру полный универсальный комплект без ручной настройки. */
function createAutomaticBaseLoadout(
  cargoCapacity: number,
  isRepairRover: boolean,
) {
  if (isRepairRover || cargoCapacity <= 0) {
    return { oxygen: 0, food: 0, equipment: 0 };
  }
  const share = Math.floor(cargoCapacity / 3);
  const remainder = cargoCapacity - share * 3;
  return {
    oxygen: share + (remainder >= 1 ? 1 : 0),
    food: share + (remainder >= 2 ? 1 : 0),
    equipment: share,
  };
}

export function createSimulationConfigFromContent(
  { balance, incidents, levelMeta, map, radio }: SimulationContent,
  placement: FacilityPlacement,
): SimulationConfig {
  return {
    seed: levelMeta.seed,
    time: { ...balance.time },
    routeWeights: { ...balance.routing.routeWeights },
    centerRules: {
      warningThreshold: balance.center.warningThreshold,
      recoveryGameMinutes: balance.center.recoveryGameMinutes,
      radioThresholds: [...balance.center.radioThresholds],
      recoveryRadioThresholds: [...balance.center.recoveryRadioThresholds],
    },
    equipmentDemand: { ...balance.center.equipmentDemand },
    equipmentDemandCenterIds: [...levelMeta.seededEquipmentDemandCenterIds],
    incidentRules: {
      eventCooldownCells: balance.routing.eventCooldownCells,
      dustStormGameMinutes: incidents.rules.dustStormGameMinutes,
      selfRepairGameMinutes: incidents.rules.selfRepairGameMinutes,
      profiles: incidents.profiles.map((profile) => ({
        id: profile.id,
        cellChance: profile.cellChance,
        weights: { ...profile.weights },
      })),
    },
    rescueRules: { ...balance.rescue },
    radioCatalog: structuredClone({
      historyLimit: radio.historyLimit,
      messages: radio.messages,
    }),
    routingMap: createRoutingMapFromContent({
      map,
      incidents,
      normalCellChance: balance.incidents.normalCellChance,
    }),
    baseCell: { ...placement.baseCell },
    centers: levelMeta.centers.map((center) => ({
      ...center,
      cell: requiredCenterCell(placement, center.id),
      oxygen: { ...center.oxygen },
      food: { ...center.food },
      equipmentCapacity: balance.center.equipmentCapacity,
    })),
    rovers: levelMeta.rovers.map((rover) => {
      const archetype = balance.roverArchetypes.find(
        ({ id }) => id === rover.archetypeId,
      );
      if (archetype === undefined) {
        throw new Error(`Validated balance не содержит ${rover.archetypeId}`);
      }
      const isRepairRover = rover.archetypeId === 'repair';
      return {
        id: rover.id,
        name: rover.name,
        archetypeId: rover.archetypeId,
        kind: isRepairRover ? 'repair' : 'courier',
        initialCell: { ...placement.baseCell },
        cargoCapacity: archetype.cargoCapacity,
        batteryCapacity: archetype.batteryCapacity,
        batteryInitial: archetype.batteryCapacity,
        gameMinutesPerNormalCell: archetype.gameMinutesPerNormalCell,
        batteryCostMultiplier: archetype.batteryCostMultiplier,
        initialCargo: createAutomaticBaseLoadout(
          archetype.cargoCapacity,
          isRepairRover,
        ),
      };
    }),
  };
}

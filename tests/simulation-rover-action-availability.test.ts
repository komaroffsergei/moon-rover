import { describe, expect, it } from 'vitest';
import type {
  CenterDefinition,
  CenterSnapshot,
  EmergencyOperationSnapshot,
  GameSnapshot,
  GridCell,
  RoverSnapshot,
  ShiftPhase,
} from '../src/domain';
import { projectRoverActionAvailability } from '../src/simulation';

const baseCell: GridCell = { column: 0, row: 0 };

function rover(
  id: string,
  overrides: Partial<RoverSnapshot> = {},
): RoverSnapshot {
  return {
    id,
    name: id,
    archetypeId: 'test',
    kind: 'courier',
    status: 'IDLE_AT_BASE',
    cell: baseCell,
    position: baseCell,
    cargo: { oxygen: 0, food: 0, equipment: 0 },
    cargoCapacity: 60,
    battery: 50,
    batteryCapacity: 100,
    gameMinutesPerNormalCell: 2,
    batteryCostMultiplier: 1,
    route: null,
    movement: null,
    activeIncident: null,
    incidentCooldownCellsRemaining: 0,
    ...overrides,
  };
}

function center(
  id: string,
  cell: GridCell,
  resources: CenterSnapshot['resources'] = {
    oxygen: 50,
    food: 50,
    equipment: 50,
  },
): CenterSnapshot {
  return {
    id,
    name: id,
    cell,
    status: 'WORKING',
    resources,
    depletionForecastGameMinutes: 240,
    recoveryRemainingGameMinutes: null,
  };
}

function centerDefinition(id: string, cell: GridCell): CenterDefinition {
  return {
    id,
    name: id,
    cell,
    oxygen: { initial: 50, capacity: 100, depletionGameMinutes: 480 },
    food: { initial: 50, capacity: 100, depletionGameMinutes: 480 },
    equipmentInitial: 50,
    equipmentCapacity: 100,
  };
}

function snapshot(
  rovers: readonly RoverSnapshot[],
  options: {
    phase?: ShiftPhase;
    centers?: readonly CenterSnapshot[];
    emergencyOperations?: readonly EmergencyOperationSnapshot[];
  } = {},
): GameSnapshot {
  return {
    phase: options.phase ?? 'RUNNING',
    elapsedRealMilliseconds: 0,
    elapsedGameMinutes: 0,
    remainingRealMilliseconds: 480_000,
    centers: options.centers ?? [],
    rovers,
    emergencyOperations: options.emergencyOperations ?? [],
    radioMessages: [],
  };
}

function availabilityFor(
  gameSnapshot: GameSnapshot,
  roverId: string,
  definitions?: readonly CenterDefinition[],
) {
  const projected = projectRoverActionAvailability(
    gameSnapshot,
    baseCell,
    definitions,
  );
  const result = projected.find(
    (availability) => availability.roverId === roverId,
  );
  if (!result) throw new Error(`Нет проекции действий для ${roverId}`);
  return result;
}

describe('rover action availability projection', () => {
  it.each([
    ['BRIEFING', true, false, true, null],
    ['RUNNING', true, true, true, 'center-one'],
    ['PAUSED', true, true, true, 'center-one'],
    ['VICTORY', false, false, false, null],
    ['DEFEAT', false, false, false, null],
  ] as const)(
    'applies the command phase gates in %s',
    (phase, canEditCargo, canAssignRoute, canCharge, unloadCenterId) => {
      const selected = rover('courier', {
        cargo: { oxygen: 10, food: 0, equipment: 0 },
      });
      const centerSnapshot = center('center-one', baseCell);
      const result = availabilityFor(
        snapshot([selected], { phase, centers: [centerSnapshot] }),
        selected.id,
      );

      expect(result).toMatchObject({
        canEditCargo,
        canAssignRoute,
        canCharge,
        unloadCenterId,
      });
      if (phase === 'BRIEFING' || phase === 'VICTORY' || phase === 'DEFEAT') {
        expect(result.repairCommands).toEqual([]);
        expect(result.rescueCommands).toEqual([]);
        expect(result.batteryTransferPairs).toEqual([]);
      }
    },
  );

  it('matches cargo, route and charge status/location/incident/operation gates', () => {
    const outAtBase = rover('out-at-base', {
      status: 'OUT_OF_BATTERY',
      battery: 0,
    });
    const fullAtBase = rover('full-at-base', {
      battery: 100,
    });
    const movingAtBase = rover('moving-at-base', {
      status: 'MOVING',
    });
    const remoteIdle = rover('remote-idle', {
      status: 'IDLE_ON_MAP',
      cell: { column: 1, row: 0 },
    });
    const incidentAtBase = rover('incident-at-base', {
      status: 'IDLE_AT_BASE',
      activeIncident: { kind: 'dustStorm', remainingGameMinutes: 5 },
    });
    const repairAtBase = rover('repair-at-base', {
      kind: 'repair',
      cargoCapacity: 0,
    });
    const busyAtBase = rover('busy-at-base');
    const operation: EmergencyOperationSnapshot = {
      kind: 'RESCUE',
      helperRoverId: busyAtBase.id,
      targetRoverId: 'missing-target',
      remainingGameMinutes: 3,
    };
    const gameSnapshot = snapshot(
      [
        outAtBase,
        fullAtBase,
        movingAtBase,
        remoteIdle,
        incidentAtBase,
        repairAtBase,
        busyAtBase,
      ],
      { emergencyOperations: [operation] },
    );

    expect(availabilityFor(gameSnapshot, outAtBase.id)).toMatchObject({
      canEditCargo: false,
      canAssignRoute: false,
      canCharge: true,
    });
    expect(availabilityFor(gameSnapshot, fullAtBase.id).canCharge).toBe(false);
    expect(availabilityFor(gameSnapshot, movingAtBase.id)).toMatchObject({
      canEditCargo: false,
      canAssignRoute: true,
      canCharge: false,
    });
    expect(availabilityFor(gameSnapshot, remoteIdle.id)).toMatchObject({
      canEditCargo: false,
      canAssignRoute: true,
      canCharge: false,
    });
    expect(availabilityFor(gameSnapshot, incidentAtBase.id).canCharge).toBe(
      false,
    );
    expect(availabilityFor(gameSnapshot, repairAtBase.id).canEditCargo).toBe(
      false,
    );
    expect(availabilityFor(gameSnapshot, busyAtBase.id).canCharge).toBe(false);
  });

  it('offers unload only for carried resources accepted by a co-located center', () => {
    const selected = rover('courier', {
      cell: { column: 2, row: 1 },
      status: 'MOVING',
      cargo: { oxygen: 4, food: 0, equipment: 0 },
    });
    const centerCell = { column: 2, row: 1 };
    const fullForCargo = center('full', centerCell, {
      oxygen: 100,
      food: 20,
      equipment: 20,
    });
    const accepting = center('accepting', centerCell, {
      oxygen: 99,
      food: 100,
      equipment: 100,
    });
    const definitions = [
      centerDefinition(fullForCargo.id, centerCell),
      centerDefinition(accepting.id, centerCell),
    ];
    const gameSnapshot = snapshot([selected], {
      centers: [fullForCargo, accepting],
    });

    expect(
      availabilityFor(gameSnapshot, selected.id, definitions).unloadCenterId,
    ).toBe(accepting.id);
    expect(availabilityFor(gameSnapshot, selected.id).unloadCenterId).toBe(
      fullForCargo.id,
    );

    const allFull = definitions.map((definition) => ({
      ...definition,
      oxygen: { ...definition.oxygen, capacity: 99 },
    }));
    expect(
      availabilityFor(gameSnapshot, selected.id, allFull).unloadCenterId,
    ).toBeNull();
    expect(
      availabilityFor(
        snapshot(
          [{ ...selected, cargo: { oxygen: 0, food: 0, equipment: 0 } }],
          {
            centers: [accepting],
          },
        ),
        selected.id,
        definitions,
      ).unloadCenterId,
    ).toBeNull();
    expect(
      availabilityFor(
        snapshot(
          [
            {
              ...selected,
              activeIncident: { kind: 'dustStorm', remainingGameMinutes: 2 },
            },
          ],
          { centers: [accepting] },
        ),
        selected.id,
        definitions,
      ).unloadCenterId,
    ).toBeNull();
  });

  it('projects valid repair and rescue commands for both participants', () => {
    const broken = rover('broken', {
      status: 'BROKEN',
      cell: { column: 2, row: 1 },
      activeIncident: { kind: 'meteorite', remainingGameMinutes: null },
    });
    const sameCellRepair = rover('repair-same', {
      kind: 'repair',
      status: 'IDLE_ON_MAP',
      cell: { column: 2, row: 1 },
    });
    const cardinalRepair = rover('repair-cardinal', {
      kind: 'repair',
      status: 'IDLE_ON_MAP',
      cell: { column: 3, row: 1 },
    });
    const diagonalRepair = rover('repair-diagonal', {
      kind: 'repair',
      status: 'IDLE_ON_MAP',
      cell: { column: 3, row: 2 },
    });
    const stuck = rover('stuck', {
      status: 'STUCK',
      cell: { column: 0, row: 2 },
      activeIncident: { kind: 'crater', remainingGameMinutes: null },
    });
    const rescueSame = rover('rescue-same', {
      status: 'IDLE_ON_MAP',
      cell: { column: 0, row: 2 },
    });
    const rescueCardinal = rover('rescue-cardinal', {
      kind: 'repair',
      status: 'IDLE_ON_MAP',
      cell: { column: 1, row: 2 },
    });
    const gameSnapshot = snapshot([
      broken,
      sameCellRepair,
      cardinalRepair,
      diagonalRepair,
      stuck,
      rescueSame,
      rescueCardinal,
    ]);

    expect(availabilityFor(gameSnapshot, broken.id).repairCommands).toEqual([
      {
        type: 'START_ROVER_REPAIR',
        repairRoverId: sameCellRepair.id,
        targetRoverId: broken.id,
      },
      {
        type: 'START_ROVER_REPAIR',
        repairRoverId: cardinalRepair.id,
        targetRoverId: broken.id,
      },
    ]);
    expect(
      availabilityFor(gameSnapshot, cardinalRepair.id).repairCommands,
    ).toEqual([
      {
        type: 'START_ROVER_REPAIR',
        repairRoverId: cardinalRepair.id,
        targetRoverId: broken.id,
      },
    ]);
    expect(availabilityFor(gameSnapshot, stuck.id).rescueCommands).toEqual([
      {
        type: 'START_CRATER_RESCUE',
        rescuerRoverId: rescueSame.id,
        targetRoverId: stuck.id,
      },
      {
        type: 'START_CRATER_RESCUE',
        rescuerRoverId: rescueCardinal.id,
        targetRoverId: stuck.id,
      },
    ]);
  });

  it('removes emergency actions for incidents, busy participants and inactive phases', () => {
    const broken = rover('broken', {
      status: 'BROKEN',
      cell: { column: 1, row: 0 },
      activeIncident: { kind: 'meteorite', remainingGameMinutes: null },
    });
    const helper = rover('helper', {
      kind: 'repair',
      status: 'IDLE_AT_BASE',
      activeIncident: { kind: 'dustStorm', remainingGameMinutes: 1 },
    });
    const withIncident = snapshot([broken, helper]);
    expect(availabilityFor(withIncident, broken.id).repairCommands).toEqual([]);

    const eligibleHelper = { ...helper, activeIncident: null };
    const busy = snapshot([broken, eligibleHelper], {
      emergencyOperations: [
        {
          kind: 'RESCUE',
          helperRoverId: eligibleHelper.id,
          targetRoverId: 'other',
          remainingGameMinutes: 1,
        },
      ],
    });
    expect(availabilityFor(busy, broken.id).repairCommands).toEqual([]);

    const briefing = snapshot([broken, eligibleHelper], { phase: 'BRIEFING' });
    expect(availabilityFor(briefing, broken.id).repairCommands).toEqual([]);
  });

  it('uses strict cardinal adjacency and all validation gates for battery transfer', () => {
    const receiver = rover('receiver', {
      kind: 'repair',
      status: 'OUT_OF_BATTERY',
      cell: { column: 2, row: 1 },
      battery: 0,
    });
    const donor = rover('donor', {
      status: 'IDLE_ON_MAP',
      cell: { column: 2, row: 2 },
      battery: 40,
    });
    const sameCell = rover('same-cell', {
      status: 'IDLE_ON_MAP',
      cell: receiver.cell,
    });
    const diagonal = rover('diagonal', {
      status: 'IDLE_ON_MAP',
      cell: { column: 3, row: 2 },
    });
    const incidentDonor = rover('incident-donor', {
      status: 'IDLE_ON_MAP',
      cell: { column: 3, row: 1 },
      activeIncident: { kind: 'dustStorm', remainingGameMinutes: 2 },
    });
    const gameSnapshot = snapshot([
      receiver,
      donor,
      sameCell,
      diagonal,
      incidentDonor,
    ]);
    const expectedPair = {
      donorRoverId: donor.id,
      repairRoverId: receiver.id,
    };

    expect(
      availabilityFor(gameSnapshot, receiver.id).batteryTransferPairs,
    ).toEqual([expectedPair]);
    expect(
      availabilityFor(gameSnapshot, donor.id).batteryTransferPairs,
    ).toEqual([expectedPair]);
    expect(
      availabilityFor(gameSnapshot, sameCell.id).batteryTransferPairs,
    ).toEqual([]);

    const busy = snapshot([receiver, donor], {
      emergencyOperations: [
        {
          kind: 'REPAIR',
          helperRoverId: donor.id,
          targetRoverId: 'other',
          remainingGameMinutes: 1,
        },
      ],
    });
    expect(availabilityFor(busy, receiver.id).batteryTransferPairs).toEqual([]);
  });

  it('does not mutate the input snapshot and returns readonly frozen DTOs', () => {
    const selected = rover('courier');
    const gameSnapshot = snapshot([selected]);
    const before = structuredClone(gameSnapshot);

    const result = projectRoverActionAvailability(gameSnapshot, baseCell);

    expect(gameSnapshot).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0]!.repairCommands)).toBe(true);
    expect(Object.isFrozen(result[0]!.rescueCommands)).toBe(true);
    expect(Object.isFrozen(result[0]!.batteryTransferPairs)).toBe(true);
  });
});

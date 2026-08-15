import type {
  BatteryTransferPair,
  CenterDefinition,
  CenterSnapshot,
  GameSnapshot,
  GridCell,
  RoverActionAvailability,
  RoverSnapshot,
  StartCraterRescueCommand,
  StartRoverRepairCommand,
} from '../../domain';
import { hasCargo } from '../cargo/cargo';
import {
  isCardinalNeighbor,
  isSameOrCardinalNeighbor,
  sameCell,
} from './cells';

const CONFIGURATION_PHASES = new Set<GameSnapshot['phase']>([
  'BRIEFING',
  'RUNNING',
  'PAUSED',
]);
const ACTIVE_PHASES = new Set<GameSnapshot['phase']>(['RUNNING', 'PAUSED']);
const ROUTABLE_STATUSES = new Set<RoverSnapshot['status']>([
  'IDLE_AT_BASE',
  'IDLE_ON_MAP',
  'MOVING',
]);

function operationRoverIds(snapshot: GameSnapshot): ReadonlySet<string> {
  return new Set(
    snapshot.emergencyOperations.flatMap(({ helperRoverId, targetRoverId }) => [
      helperRoverId,
      targetRoverId,
    ]),
  );
}

function isIdleOperational(
  rover: RoverSnapshot,
  busyRoverIds: ReadonlySet<string>,
): boolean {
  return (
    !busyRoverIds.has(rover.id) &&
    rover.battery > 0 &&
    rover.activeIncident === null &&
    (rover.status === 'IDLE_AT_BASE' || rover.status === 'IDLE_ON_MAP')
  );
}

function repairCommands(
  snapshot: GameSnapshot,
  busyRoverIds: ReadonlySet<string>,
): readonly StartRoverRepairCommand[] {
  if (!ACTIVE_PHASES.has(snapshot.phase)) return Object.freeze([]);

  const commands: StartRoverRepairCommand[] = [];
  for (const helper of snapshot.rovers) {
    if (helper.kind !== 'repair' || !isIdleOperational(helper, busyRoverIds)) {
      continue;
    }
    for (const target of snapshot.rovers) {
      if (
        busyRoverIds.has(target.id) ||
        target.kind !== 'courier' ||
        target.status !== 'BROKEN' ||
        target.activeIncident?.kind !== 'meteorite' ||
        !isSameOrCardinalNeighbor(helper.cell, target.cell)
      ) {
        continue;
      }
      commands.push(
        Object.freeze({
          type: 'START_ROVER_REPAIR',
          repairRoverId: helper.id,
          targetRoverId: target.id,
        }),
      );
    }
  }
  return Object.freeze(commands);
}

function rescueCommands(
  snapshot: GameSnapshot,
  busyRoverIds: ReadonlySet<string>,
): readonly StartCraterRescueCommand[] {
  if (!ACTIVE_PHASES.has(snapshot.phase)) return Object.freeze([]);

  const commands: StartCraterRescueCommand[] = [];
  for (const helper of snapshot.rovers) {
    if (!isIdleOperational(helper, busyRoverIds)) continue;
    for (const target of snapshot.rovers) {
      if (
        busyRoverIds.has(target.id) ||
        target.status !== 'STUCK' ||
        target.activeIncident?.kind !== 'crater' ||
        !isSameOrCardinalNeighbor(helper.cell, target.cell)
      ) {
        continue;
      }
      commands.push(
        Object.freeze({
          type: 'START_CRATER_RESCUE',
          rescuerRoverId: helper.id,
          targetRoverId: target.id,
        }),
      );
    }
  }
  return Object.freeze(commands);
}

function batteryTransferPairs(
  snapshot: GameSnapshot,
  busyRoverIds: ReadonlySet<string>,
): readonly BatteryTransferPair[] {
  if (!ACTIVE_PHASES.has(snapshot.phase)) return Object.freeze([]);

  const pairs: BatteryTransferPair[] = [];
  for (const donor of snapshot.rovers) {
    if (donor.kind !== 'courier' || !isIdleOperational(donor, busyRoverIds)) {
      continue;
    }
    for (const receiver of snapshot.rovers) {
      if (
        busyRoverIds.has(receiver.id) ||
        receiver.kind !== 'repair' ||
        receiver.battery !== 0 ||
        receiver.status !== 'OUT_OF_BATTERY' ||
        receiver.activeIncident !== null ||
        !isCardinalNeighbor(donor.cell, receiver.cell)
      ) {
        continue;
      }
      pairs.push(
        Object.freeze({
          donorRoverId: donor.id,
          repairRoverId: receiver.id,
        }),
      );
    }
  }
  return Object.freeze(pairs);
}

function centerAcceptsCargo(
  center: CenterSnapshot,
  definition: CenterDefinition,
  rover: RoverSnapshot,
): boolean {
  return (
    Math.min(
      rover.cargo.oxygen,
      definition.oxygen.capacity - center.resources.oxygen,
    ) > 0 ||
    Math.min(
      rover.cargo.food,
      definition.food.capacity - center.resources.food,
    ) > 0 ||
    Math.min(
      rover.cargo.equipment,
      definition.equipmentCapacity - center.resources.equipment,
    ) > 0
  );
}

function unloadCenterId(
  rover: RoverSnapshot,
  snapshot: GameSnapshot,
  busyRoverIds: ReadonlySet<string>,
  centerDefinitions: readonly CenterDefinition[] | undefined,
): string | null {
  if (
    !ACTIVE_PHASES.has(snapshot.phase) ||
    busyRoverIds.has(rover.id) ||
    rover.activeIncident !== null ||
    !hasCargo(rover.cargo)
  ) {
    return null;
  }

  for (const center of snapshot.centers) {
    if (!sameCell(rover.cell, center.cell)) continue;
    if (centerDefinitions === undefined) return center.id;
    const definition = centerDefinitions.find(({ id }) => id === center.id);
    if (definition && centerAcceptsCargo(center, definition, rover)) {
      return center.id;
    }
  }
  return null;
}

function includesRover(
  roverId: string,
  command:
    StartRoverRepairCommand | StartCraterRescueCommand | BatteryTransferPair,
): boolean {
  if ('repairRoverId' in command && 'targetRoverId' in command) {
    return (
      command.repairRoverId === roverId || command.targetRoverId === roverId
    );
  }
  if ('rescuerRoverId' in command) {
    return (
      command.rescuerRoverId === roverId || command.targetRoverId === roverId
    );
  }
  return command.donorRoverId === roverId || command.repairRoverId === roverId;
}

/**
 * Проецирует допустимые команды, не меняя snapshot. Проверка ёмкости unload
 * выполняется только при переданных validated center definitions.
 */
export function projectRoverActionAvailability(
  snapshot: GameSnapshot,
  baseCell: GridCell,
  centerDefinitions?: readonly CenterDefinition[],
): readonly RoverActionAvailability[] {
  const busyRoverIds = operationRoverIds(snapshot);
  const repairs = repairCommands(snapshot, busyRoverIds);
  const rescues = rescueCommands(snapshot, busyRoverIds);
  const transfers = batteryTransferPairs(snapshot, busyRoverIds);

  return Object.freeze(
    snapshot.rovers.map((rover) => {
      const isConfigurable =
        CONFIGURATION_PHASES.has(snapshot.phase) &&
        !busyRoverIds.has(rover.id) &&
        rover.activeIncident === null;
      const hasRoutableStatus = ROUTABLE_STATUSES.has(rover.status);

      return Object.freeze({
        roverId: rover.id,
        canEditCargo:
          isConfigurable &&
          rover.kind === 'courier' &&
          rover.status !== 'MOVING' &&
          hasRoutableStatus &&
          sameCell(rover.cell, baseCell),
        canAssignRoute:
          ACTIVE_PHASES.has(snapshot.phase) &&
          !busyRoverIds.has(rover.id) &&
          rover.activeIncident === null &&
          hasRoutableStatus,
        canCharge:
          isConfigurable &&
          rover.status !== 'MOVING' &&
          rover.battery < rover.batteryCapacity &&
          sameCell(rover.cell, baseCell),
        unloadCenterId: unloadCenterId(
          rover,
          snapshot,
          busyRoverIds,
          centerDefinitions,
        ),
        repairCommands: Object.freeze(
          repairs.filter((command) => includesRover(rover.id, command)),
        ),
        rescueCommands: Object.freeze(
          rescues.filter((command) => includesRover(rover.id, command)),
        ),
        batteryTransferPairs: Object.freeze(
          transfers.filter((pair) => includesRover(rover.id, pair)),
        ),
      });
    }),
  );
}

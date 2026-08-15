import type {
  CommandResult,
  DomainEvent,
  GridCell,
  RescueRules,
} from '../../domain';
import { roundGameValue } from '../clock/fixedStepClock';
import { resolveRoverIncident } from '../movement/resolveRoverIncident';
import { isSameOrCardinalNeighbor, sameCell } from '../rovers/cells';
import type { MutableRoverState } from '../types';
import type { MutableEmergencyOperation } from './types';

function roverById(
  rovers: readonly MutableRoverState[],
  roverId: string,
): MutableRoverState | undefined {
  return rovers.find(({ id }) => id === roverId);
}

function operationIncludes(
  operations: readonly MutableEmergencyOperation[],
  roverId: string,
): boolean {
  return operations.some(
    ({ helperRoverId, targetRoverId }) =>
      helperRoverId === roverId || targetRoverId === roverId,
  );
}

function isIdleOperational(rover: MutableRoverState): boolean {
  return (
    rover.battery > 0 &&
    rover.activeIncident === null &&
    (rover.status === 'IDLE_AT_BASE' || rover.status === 'IDLE_ON_MAP')
  );
}

function compareAutomaticRepairTargets(
  helper: MutableRoverState,
  left: MutableRoverState,
  right: MutableRoverState,
): number {
  const sameCellDifference =
    Number(!sameCell(helper.cell, left.cell)) -
    Number(!sameCell(helper.cell, right.cell));
  if (sameCellDifference !== 0) return sameCellDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function startOperation(
  operations: MutableEmergencyOperation[],
  helper: MutableRoverState,
  target: MutableRoverState,
  kind: MutableEmergencyOperation['kind'],
  durationGameMinutes: number,
  gameMinute: number,
): CommandResult {
  operations.push({
    kind,
    helperRoverId: helper.id,
    targetRoverId: target.id,
    remainingGameMinutes: durationGameMinutes,
  });
  helper.status = kind === 'REPAIR' ? 'REPAIRING' : 'RESCUING';
  return {
    ok: true,
    events: [
      {
        type: 'EMERGENCY_OPERATION_STARTED',
        operationKind: kind,
        helperRoverId: helper.id,
        targetRoverId: target.id,
        durationGameMinutes,
        cell: { ...target.cell },
        gameMinute,
      },
    ],
  };
}

export function beginRoverRepair(
  rovers: readonly MutableRoverState[],
  operations: MutableEmergencyOperation[],
  repairRoverId: string,
  targetRoverId: string,
  rules: RescueRules,
  gameMinute: number,
): CommandResult {
  const helper = roverById(rovers, repairRoverId);
  const target = roverById(rovers, targetRoverId);
  if (helper === undefined || target === undefined) {
    return { ok: false, code: 'ROVER_NOT_FOUND' };
  }
  if (
    operationIncludes(operations, helper.id) ||
    operationIncludes(operations, target.id)
  ) {
    return { ok: false, code: 'ROVER_UNAVAILABLE' };
  }
  if (
    target.kind !== 'courier' ||
    target.status !== 'BROKEN' ||
    target.activeIncident?.kind !== 'meteorite'
  ) {
    return { ok: false, code: 'TARGET_NOT_BROKEN' };
  }
  if (helper.kind !== 'repair') {
    return { ok: false, code: 'RESCUER_INVALID_KIND' };
  }
  if (!isIdleOperational(helper)) {
    return { ok: false, code: 'ROVER_UNAVAILABLE' };
  }
  if (!isSameOrCardinalNeighbor(helper.cell, target.cell)) {
    return { ok: false, code: 'ROVER_OUT_OF_RANGE' };
  }
  return startOperation(
    operations,
    helper,
    target,
    'REPAIR',
    rules.repairGameMinutes,
    gameMinute,
  );
}

export function beginCraterRescue(
  rovers: readonly MutableRoverState[],
  operations: MutableEmergencyOperation[],
  rescuerRoverId: string,
  targetRoverId: string,
  rules: RescueRules,
  gameMinute: number,
): CommandResult {
  const helper = roverById(rovers, rescuerRoverId);
  const target = roverById(rovers, targetRoverId);
  if (helper === undefined || target === undefined) {
    return { ok: false, code: 'ROVER_NOT_FOUND' };
  }
  if (
    operationIncludes(operations, helper.id) ||
    operationIncludes(operations, target.id)
  ) {
    return { ok: false, code: 'ROVER_UNAVAILABLE' };
  }
  if (target.status !== 'STUCK' || target.activeIncident?.kind !== 'crater') {
    return { ok: false, code: 'TARGET_NOT_STUCK' };
  }
  if (!isIdleOperational(helper)) {
    return { ok: false, code: 'ROVER_UNAVAILABLE' };
  }
  if (!isSameOrCardinalNeighbor(helper.cell, target.cell)) {
    return { ok: false, code: 'ROVER_OUT_OF_RANGE' };
  }
  return startOperation(
    operations,
    helper,
    target,
    'RESCUE',
    rules.craterRescueGameMinutes,
    gameMinute,
  );
}

function readyStatus(rover: MutableRoverState, baseCell: GridCell) {
  if (rover.battery <= 0) return 'OUT_OF_BATTERY' as const;
  if (rover.route !== null) return 'MOVING' as const;
  return sameCell(rover.cell, baseCell)
    ? ('IDLE_AT_BASE' as const)
    : ('IDLE_ON_MAP' as const);
}

function completeOperation(
  operation: MutableEmergencyOperation,
  rovers: readonly MutableRoverState[],
  baseCell: GridCell,
  gameMinute: number,
  events: DomainEvent[],
): void {
  const helper = roverById(rovers, operation.helperRoverId);
  const target = roverById(rovers, operation.targetRoverId);
  if (helper === undefined || target === undefined) {
    throw new Error('Emergency operation ссылается на отсутствующий rover');
  }

  events.push({
    type: 'EMERGENCY_OPERATION_COMPLETED',
    operationKind: operation.kind,
    helperRoverId: operation.helperRoverId,
    targetRoverId: operation.targetRoverId,
    cell: { ...target.cell },
    gameMinute,
  });
  resolveRoverIncident(
    target,
    baseCell,
    gameMinute,
    events,
    operation.kind === 'REPAIR' ? 'CLEAR' : 'RESUME',
  );
  helper.status = readyStatus(helper, baseCell);
}

function advanceOperation(
  operation: MutableEmergencyOperation,
  rovers: readonly MutableRoverState[],
  deltaGameMinutes: number,
  gameMinuteAtStepStart: number,
  baseCell: GridCell,
  events: DomainEvent[],
): number {
  const used = Math.min(deltaGameMinutes, operation.remainingGameMinutes);
  operation.remainingGameMinutes = roundGameValue(
    operation.remainingGameMinutes - used,
  );
  if (operation.remainingGameMinutes <= 0) {
    completeOperation(
      operation,
      rovers,
      baseCell,
      roundGameValue(gameMinuteAtStepStart + used),
      events,
    );
  }
  return used;
}

/**
 * Starts at most one canonical repair after a repair rover's final arrival.
 * Same-cell targets win over cardinal neighbors, then IDs provide a stable tie.
 * The elapsed tail keeps a fractional arrival on the exact five-minute timer.
 */
export function beginAutomaticRoverRepairAfterArrival(
  rovers: readonly MutableRoverState[],
  operations: MutableEmergencyOperation[],
  repairRoverId: string,
  rules: RescueRules,
  arrivalGameMinute: number,
  elapsedGameMinutesAfterArrival: number,
  baseCell: GridCell,
): readonly DomainEvent[] {
  const helper = roverById(rovers, repairRoverId);
  if (helper === undefined || helper.kind !== 'repair') return [];

  const candidates = rovers
    .filter(
      (target) =>
        target.kind === 'courier' &&
        target.status === 'BROKEN' &&
        target.activeIncident?.kind === 'meteorite' &&
        isSameOrCardinalNeighbor(helper.cell, target.cell),
    )
    .sort((left, right) => compareAutomaticRepairTargets(helper, left, right));

  for (const target of candidates) {
    const started = beginRoverRepair(
      rovers,
      operations,
      helper.id,
      target.id,
      rules,
      arrivalGameMinute,
    );
    if (!started.ok) continue;

    const operation = operations.at(-1);
    if (
      operation === undefined ||
      operation.kind !== 'REPAIR' ||
      operation.helperRoverId !== helper.id ||
      operation.targetRoverId !== target.id
    ) {
      throw new Error('Автоматический ремонт не создал ожидаемую operation');
    }

    const events = [...started.events];
    const elapsedTail = Math.max(
      0,
      roundGameValue(elapsedGameMinutesAfterArrival),
    );
    if (elapsedTail > 0) {
      advanceOperation(
        operation,
        rovers,
        elapsedTail,
        arrivalGameMinute,
        baseCell,
        events,
      );
      if (operation.remainingGameMinutes <= 0) {
        const operationIndex = operations.indexOf(operation);
        if (operationIndex >= 0) operations.splice(operationIndex, 1);
      }
    }
    return events;
  }
  return [];
}

export interface StepEmergencyOperationsResult {
  events: readonly DomainEvent[];
  consumedGameMinutesByRoverId: ReadonlyMap<string, number>;
}

export function stepEmergencyOperations(
  operations: MutableEmergencyOperation[],
  rovers: readonly MutableRoverState[],
  deltaGameMinutes: number,
  gameMinuteAtStepStart: number,
  baseCell: GridCell,
): StepEmergencyOperationsResult {
  const events: DomainEvent[] = [];
  const consumed = new Map<string, number>();
  const completedIndices: number[] = [];

  operations.forEach((operation, index) => {
    const used = advanceOperation(
      operation,
      rovers,
      deltaGameMinutes,
      gameMinuteAtStepStart,
      baseCell,
      events,
    );
    consumed.set(operation.helperRoverId, used);
    consumed.set(operation.targetRoverId, used);
    if (operation.remainingGameMinutes > 0) return;
    completedIndices.push(index);
  });

  completedIndices.reverse().forEach((index) => operations.splice(index, 1));
  return { events, consumedGameMinutesByRoverId: consumed };
}

import type { CenterRules, CommandResult } from '../../domain';
import type { MutableCenterState, MutableRoverState } from '../types';
import { deliverResources } from '../centers/deliverResources';
import { sameCell } from '../rovers/cells';
import { hasCargo } from './cargo';

export function unloadRoverCargo(
  rover: MutableRoverState,
  center: MutableCenterState,
  currentGameMinute: number,
  rules: CenterRules,
): CommandResult {
  if (!sameCell(rover.cell, center.cell)) {
    return { ok: false, code: 'ROVER_NOT_AT_CENTER' };
  }

  const offeredCargo = rover.cargo;
  if (!hasCargo(offeredCargo)) {
    return { ok: false, code: 'ROVER_CARGO_EMPTY' };
  }

  const free = {
    oxygen: center.oxygen.capacity - center.oxygen.current,
    food: center.food.capacity - center.food.current,
    equipment: center.equipmentCapacity - center.equipment,
  };
  const canTransfer =
    Math.min(offeredCargo.oxygen, free.oxygen) > 0 ||
    Math.min(offeredCargo.food, free.food) > 0 ||
    Math.min(offeredCargo.equipment, free.equipment) > 0;
  if (!canTransfer) return { ok: false, code: 'CENTER_FULL' };

  const result = deliverResources(
    center,
    offeredCargo,
    currentGameMinute,
    rules,
  );
  // Subtract the actual capped transfer so excess cargo stays with the rover.
  rover.cargo = {
    oxygen: rover.cargo.oxygen - result.transferred.oxygen,
    food: rover.cargo.food - result.transferred.food,
    equipment: rover.cargo.equipment - result.transferred.equipment,
  };
  return {
    ok: true,
    events: [
      {
        type: 'CARGO_DELIVERED',
        roverId: rover.id,
        centerId: center.id,
        delivered: result.transferred,
        cell: { ...center.cell },
        gameMinute: currentGameMinute,
      },
      ...result.events,
    ],
  };
}

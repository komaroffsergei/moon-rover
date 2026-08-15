import type { Cargo, CommandResult, GridCell } from '../../domain';
import type { MutableRoverState } from '../types';
import { sameCell } from '../rovers/cells';
import { exceedsCargoCapacity, hasCargo, isValidCargo } from './cargo';

export function setRoverCargo(
  rover: MutableRoverState,
  cargo: Cargo,
  baseCell: GridCell,
): CommandResult {
  if (!isValidCargo(cargo)) return { ok: false, code: 'INVALID_CARGO' };
  if (rover.kind === 'repair' && hasCargo(cargo)) {
    return { ok: false, code: 'REPAIR_ROVER_CANNOT_CARRY' };
  }
  if (!sameCell(rover.cell, baseCell)) {
    return { ok: false, code: 'ROVER_NOT_AT_BASE' };
  }
  if (exceedsCargoCapacity(cargo, rover.cargoCapacity)) {
    return { ok: false, code: 'CARGO_CAPACITY_EXCEEDED' };
  }

  rover.baseLoadout = { ...cargo };
  rover.cargo = { ...cargo };
  return { ok: true, events: [] };
}

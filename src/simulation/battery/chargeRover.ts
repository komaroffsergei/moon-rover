import type { CommandResult, GridCell } from '../../domain';
import type { MutableRoverState } from '../types';
import { sameCell } from '../rovers/cells';

export function chargeRover(
  rover: MutableRoverState,
  baseCell: GridCell,
): CommandResult {
  if (!sameCell(rover.cell, baseCell)) {
    return { ok: false, code: 'ROVER_NOT_AT_BASE' };
  }
  rover.battery = rover.batteryCapacity;
  if (rover.status === 'OUT_OF_BATTERY') {
    rover.status = rover.route === null ? 'IDLE_AT_BASE' : 'MOVING';
  }
  return { ok: true, events: [] };
}

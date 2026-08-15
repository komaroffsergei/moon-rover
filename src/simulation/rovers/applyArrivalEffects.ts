import type { CenterRules, DomainEvent, GridCell } from '../../domain';
import { unloadRoverCargo } from '../cargo/unloadRoverCargo';
import type { MutableCenterState, MutableRoverState } from '../types';
import { sameCell } from './cells';
import { serviceRoverAtBase } from './createRoverState';

export function applyArrivalEffects(
  sourceEvents: readonly DomainEvent[],
  rovers: readonly MutableRoverState[],
  centers: readonly MutableCenterState[],
  baseCell: GridCell,
  centerRules: CenterRules,
): readonly DomainEvent[] {
  const events: DomainEvent[] = [];
  const servicedAtBase = new Set<string>();

  for (const event of sourceEvents) {
    if (
      event.type === 'ROVER_OUT_OF_BATTERY' &&
      servicedAtBase.has(event.roverId)
    ) {
      continue;
    }

    events.push(event);
    if (event.type !== 'ROVER_ARRIVED') continue;

    const rover = rovers.find(({ id }) => id === event.roverId);
    if (rover === undefined) continue;
    if (sameCell(rover.cell, baseCell)) {
      serviceRoverAtBase(rover);
      servicedAtBase.add(rover.id);
      continue;
    }

    const center = centers.find(({ cell }) => sameCell(cell, rover.cell));
    if (center === undefined) continue;
    const delivery = unloadRoverCargo(
      rover,
      center,
      event.gameMinute,
      centerRules,
    );
    if (delivery.ok) events.push(...delivery.events);
  }

  return events;
}

import type { GridCell, RoutingMap } from '../../domain';
import {
  appendRouteStep,
  isRouteDraftValid,
  type RouteDraft,
} from './routeDraft';

const CARDINAL_OFFSETS = Object.freeze([
  Object.freeze({ column: 0, row: -1 }),
  Object.freeze({ column: 1, row: 0 }),
  Object.freeze({ column: 0, row: 1 }),
  Object.freeze({ column: -1, row: 0 }),
]);

function copyCell(cell: GridCell): GridCell {
  return Object.freeze({ column: cell.column, row: cell.row });
}

/**
 * Returns the cells that can be appended to a valid manual route draft.
 * The order is deterministic: north, east, south, west.
 */
export function candidateRouteCells(
  draft: RouteDraft,
  map: RoutingMap,
): readonly GridCell[] {
  if (!isRouteDraftValid(draft, map)) {
    throw new RangeError('Кандидаты требуют допустимый ручной маршрут');
  }

  const tail = draft.steps.at(-1) ?? draft.origin;
  const candidates = CARDINAL_OFFSETS.flatMap((offset) => {
    const cell = {
      column: tail.column + offset.column,
      row: tail.row + offset.row,
    };

    return appendRouteStep(draft, cell, map).ok ? [copyCell(cell)] : [];
  });

  return Object.freeze(candidates);
}

import type { GridCell, RoutingMap } from '../../domain';

export interface RouteDraft {
  readonly origin: GridCell;
  readonly steps: readonly GridCell[];
}

export type AppendRouteStepErrorCode =
  | 'CELL_OUT_OF_BOUNDS'
  | 'CELL_NOT_WALKABLE'
  | 'CELL_NOT_ADJACENT'
  | 'UNDO_REQUIRED';

export type AppendRouteStepResult =
  | { ok: true; draft: RouteDraft }
  | { ok: false; code: AppendRouteStepErrorCode };

function copyCell(cell: GridCell): GridCell {
  return Object.freeze({ column: cell.column, row: cell.row });
}

function freezeDraft(origin: GridCell, steps: readonly GridCell[]): RouteDraft {
  return Object.freeze({
    origin: copyCell(origin),
    steps: Object.freeze(steps.map(copyCell)),
  });
}

function cellsEqual(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

function isInBounds(cell: GridCell, map: RoutingMap): boolean {
  return (
    Number.isInteger(cell.column) &&
    Number.isInteger(cell.row) &&
    cell.column >= 0 &&
    cell.column < map.width &&
    cell.row >= 0 &&
    cell.row < map.height
  );
}

function routingCellAt(map: RoutingMap, cell: GridCell) {
  return map.cells[cell.row * map.width + cell.column];
}

function isCardinalNeighbor(left: GridCell, right: GridCell): boolean {
  return (
    Math.abs(left.column - right.column) + Math.abs(left.row - right.row) === 1
  );
}

export function createRouteDraft(origin: GridCell): RouteDraft {
  return freezeDraft(origin, []);
}

export function appendRouteStep(
  draft: RouteDraft,
  candidate: GridCell,
  map: RoutingMap,
): AppendRouteStepResult {
  if (!isInBounds(candidate, map)) {
    return { ok: false, code: 'CELL_OUT_OF_BOUNDS' };
  }

  if (!routingCellAt(map, candidate)?.walkable) {
    return { ok: false, code: 'CELL_NOT_WALKABLE' };
  }

  const tail = draft.steps.at(-1) ?? draft.origin;
  const previous = draft.steps.length > 1 ? draft.steps.at(-2) : draft.origin;
  if (
    draft.steps.length > 0 &&
    previous !== undefined &&
    cellsEqual(previous, candidate)
  ) {
    return { ok: false, code: 'UNDO_REQUIRED' };
  }

  if (!isCardinalNeighbor(tail, candidate)) {
    return { ok: false, code: 'CELL_NOT_ADJACENT' };
  }

  return {
    ok: true,
    draft: freezeDraft(draft.origin, [...draft.steps, candidate]),
  };
}

export function undoRouteStep(draft: RouteDraft): RouteDraft {
  return freezeDraft(draft.origin, draft.steps.slice(0, -1));
}

export function clearRouteDraft(draft: RouteDraft): RouteDraft {
  return createRouteDraft(draft.origin);
}

export function isRouteDraftValid(draft: RouteDraft, map: RoutingMap): boolean {
  if (
    !isInBounds(draft.origin, map) ||
    !routingCellAt(map, draft.origin)?.walkable
  ) {
    return false;
  }

  let validated = createRouteDraft(draft.origin);

  for (const step of draft.steps) {
    const result = appendRouteStep(validated, step, map);
    if (!result.ok) return false;
    validated = result.draft;
  }

  return true;
}

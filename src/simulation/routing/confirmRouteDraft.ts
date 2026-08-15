import type {
  ConfirmedRoute,
  GridCell,
  NavigationLeg,
  RouteGoal,
  RoutingMap,
} from '../../domain';
import { forecastRoute, type RouteForecastProfile } from './forecastRoute';
import { isRouteDraftValid, type RouteDraft } from './routeDraft';

interface GoalEntity {
  readonly id: string;
  readonly cell: GridCell;
}

export interface RouteGoalContext {
  readonly baseCell: GridCell;
  readonly centers: readonly GoalEntity[];
  readonly rovers: readonly GoalEntity[];
}

export type ConfirmRouteDraftErrorCode =
  'ROUTE_EMPTY' | 'ROUTE_INVALID' | 'ROUTE_GOAL_INVALID';

export type ConfirmRouteDraftResult =
  | { ok: true; route: ConfirmedRoute }
  | { ok: false; code: ConfirmRouteDraftErrorCode };

function cellsEqual(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

function isCardinalNeighbor(left: GridCell, right: GridCell): boolean {
  return (
    Math.abs(left.column - right.column) + Math.abs(left.row - right.row) === 1
  );
}

function goalMatchesEndpoint(
  goal: RouteGoal,
  endpoint: GridCell,
  context: RouteGoalContext,
): boolean {
  if (goal.kind === 'BASE') {
    return cellsEqual(endpoint, context.baseCell);
  }
  if (goal.kind === 'CELL') {
    return cellsEqual(endpoint, goal.cell);
  }

  const entities = goal.kind === 'CENTER' ? context.centers : context.rovers;
  const targetId = goal.kind === 'CENTER' ? goal.centerId : goal.roverId;
  const target = entities.find(({ id }) => id === targetId);
  if (!target) return false;

  return goal.kind === 'RESCUE_ADJACENT'
    ? isCardinalNeighbor(endpoint, target.cell)
    : cellsEqual(endpoint, target.cell);
}

function freezeGoal(goal: RouteGoal): RouteGoal {
  if (goal.kind === 'CELL') {
    return Object.freeze({
      kind: 'CELL',
      cell: Object.freeze({ ...goal.cell }),
    });
  }
  return Object.freeze({ ...goal });
}

function freezeConfirmedRoute(
  draft: RouteDraft,
  goal: RouteGoal,
  map: RoutingMap,
  profile: RouteForecastProfile,
): ConfirmedRoute {
  const origin = Object.freeze({ ...draft.origin });
  const originPosition = Object.freeze({ ...draft.origin });
  const steps = Object.freeze(
    draft.steps.map((step) => Object.freeze({ ...step })),
  );
  const legs: NavigationLeg[] = [];
  let from = originPosition;
  for (const step of steps) {
    const to = Object.freeze({ ...step });
    const distance = Math.hypot(to.column - from.column, to.row - from.row);
    legs.push(
      Object.freeze({
        from,
        to,
        distance,
        traversals: Object.freeze([
          Object.freeze({
            cell: step,
            distance,
            startDistance: 0,
            endDistance: distance,
            entersCell: true,
          }),
        ]),
      }),
    );
    from = to;
  }
  const forecast = Object.freeze(forecastRoute(draft, map, profile));

  return Object.freeze({
    mode: 'LEGACY_CELL',
    origin,
    originPosition,
    steps,
    legs: Object.freeze(legs),
    goal: freezeGoal(goal),
    forecast,
  });
}

export function confirmRouteDraft(
  draft: RouteDraft,
  map: RoutingMap,
  profile: RouteForecastProfile,
  goal: RouteGoal,
  goalContext: RouteGoalContext,
): ConfirmRouteDraftResult {
  if (draft.steps.length === 0) {
    return { ok: false, code: 'ROUTE_EMPTY' };
  }
  if (!isRouteDraftValid(draft, map)) {
    return { ok: false, code: 'ROUTE_INVALID' };
  }

  const endpoint = draft.steps.at(-1);
  if (!endpoint || !goalMatchesEndpoint(goal, endpoint, goalContext)) {
    return { ok: false, code: 'ROUTE_GOAL_INVALID' };
  }

  return {
    ok: true,
    route: freezeConfirmedRoute(draft, goal, map, profile),
  };
}

import type {
  ConfirmedRoute,
  GridCell,
  NavigationLeg,
  NavigationPoint,
  RoutingMap,
} from '../../domain';
import type { FindNavigationRouteResult } from './findNavigationRoute';
import {
  forecastNavigationRoute,
  type RouteForecastProfile,
} from './forecastRoute';

function freezeCell(cell: GridCell): GridCell {
  return Object.freeze({ column: cell.column, row: cell.row });
}

function freezePoint(point: NavigationPoint): NavigationPoint {
  return Object.freeze({ column: point.column, row: point.row });
}

function freezeLeg(leg: NavigationLeg): NavigationLeg {
  return Object.freeze({
    from: freezePoint(leg.from),
    to: freezePoint(leg.to),
    distance: leg.distance,
    traversals: Object.freeze(
      leg.traversals.map((traversal) =>
        Object.freeze({
          ...traversal,
          cell: freezeCell(traversal.cell),
        }),
      ),
    ),
  });
}

export function createNavigationRoute(
  originCell: GridCell,
  originPosition: NavigationPoint,
  destination: GridCell,
  result: Extract<FindNavigationRouteResult, { readonly ok: true }>,
  map: RoutingMap,
  profile: RouteForecastProfile,
): ConfirmedRoute {
  const legs = Object.freeze(result.legs.map(freezeLeg));
  return Object.freeze({
    mode: 'FREE_NAVIGATION',
    origin: freezeCell(originCell),
    originPosition: freezePoint(originPosition),
    steps: Object.freeze(result.steps.map(freezeCell)),
    legs,
    goal: Object.freeze({
      kind: 'CELL',
      cell: freezeCell(destination),
    }),
    forecast: Object.freeze(forecastNavigationRoute(legs, map, profile)),
  });
}

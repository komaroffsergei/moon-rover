import type { GridCell } from '../../domain';

export function sameCell(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

export function cardinalDistance(left: GridCell, right: GridCell): number {
  return Math.abs(left.column - right.column) + Math.abs(left.row - right.row);
}

export function isCardinalNeighbor(left: GridCell, right: GridCell): boolean {
  return cardinalDistance(left, right) === 1;
}

export function isSameOrCardinalNeighbor(
  left: GridCell,
  right: GridCell,
): boolean {
  return cardinalDistance(left, right) <= 1;
}

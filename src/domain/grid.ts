export interface GridCell {
  column: number;
  row: number;
}

/** Дробная позиция в координатах сетки; целые значения совпадают с центрами клеток. */
export interface NavigationPoint {
  column: number;
  row: number;
}

function assertCoefficient(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} должен быть конечным и неотрицательным`);
  }
}

export function calculateCellBatteryCost(
  movementCost: number,
  batteryCostMultiplier: number,
): number {
  assertCoefficient('movementCost', movementCost);
  assertCoefficient('batteryCostMultiplier', batteryCostMultiplier);
  const cost = movementCost * batteryCostMultiplier;
  if (!Number.isFinite(cost)) {
    throw new RangeError('Стоимость входа в клетку должна быть конечной');
  }
  return cost;
}

export function calculateBatteryAfterCellEntry(
  currentBattery: number,
  movementCost: number,
  batteryCostMultiplier: number,
): number {
  assertCoefficient('currentBattery', currentBattery);
  return Math.max(
    0,
    currentBattery -
      calculateCellBatteryCost(movementCost, batteryCostMultiplier),
  );
}

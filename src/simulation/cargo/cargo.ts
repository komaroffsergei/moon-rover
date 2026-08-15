import type { Cargo } from '../../domain';

export const CARGO_RESOURCES = [
  'oxygen',
  'food',
  'equipment',
] as const satisfies readonly (keyof Cargo)[];

export function cargoTotal(cargo: Cargo): number {
  return CARGO_RESOURCES.reduce(
    (total, resource) => total + cargo[resource],
    0,
  );
}

export function exceedsCargoCapacity(cargo: Cargo, capacity: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(capacity));
  return cargoTotal(cargo) > capacity + tolerance;
}

export function hasCargo(cargo: Cargo): boolean {
  return CARGO_RESOURCES.some((resource) => cargo[resource] > 0);
}

export function isValidCargo(cargo: Cargo): boolean {
  return CARGO_RESOURCES.every(
    (resource) => Number.isFinite(cargo[resource]) && cargo[resource] >= 0,
  );
}

export function formatGameQuantity(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError('Отображаемое количество должно быть конечным числом');
  }

  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

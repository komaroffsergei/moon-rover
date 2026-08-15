/**
 * Поворачивает к эквивалентному целевому углу по кратчайшей дуге, сохраняя
 * числовую непрерывность при переходе через границу -π/π.
 */
export function rotateTowards(
  current: number,
  target: number,
  maximumDelta: number,
): number {
  const delta = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current),
  );
  if (Math.abs(delta) <= maximumDelta) return current + delta;
  return current + Math.sign(delta) * maximumDelta;
}

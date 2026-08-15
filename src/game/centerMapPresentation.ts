import type { CenterSnapshot } from '../domain';

export type CenterMapTone = 'safe' | 'warning' | 'critical';

export interface CenterMapPresentation {
  readonly label: string;
  readonly tone: CenterMapTone;
}

function pad2(value: number): string {
  return Math.max(0, Math.floor(value)).toString().padStart(2, '0');
}

function formatGameMinutes(gameMinutes: number): string {
  const minutes = Math.max(0, Math.ceil(gameMinutes));
  return `${pad2(minutes / 60)}:${pad2(minutes % 60)}`;
}

/** Даёт карте текстовый эквивалент критического цвета и recovery timer. */
export function createCenterMapPresentation(
  center: CenterSnapshot,
): CenterMapPresentation {
  if (
    center.status === 'RECOVERY' &&
    center.recoveryRemainingGameMinutes !== null
  ) {
    return Object.freeze({
      label: `${center.name}\n! Критично · ${formatGameMinutes(center.recoveryRemainingGameMinutes)}`,
      tone: 'critical',
    });
  }
  if (center.status === 'LOST') {
    return Object.freeze({
      label: `${center.name}\n! Центр потерян`,
      tone: 'critical',
    });
  }
  return Object.freeze({
    label: center.name,
    tone: center.status === 'WARNING' ? 'warning' : 'safe',
  });
}

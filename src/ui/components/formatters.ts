import type { IncidentKind, RoverStatus } from '../../domain';

function pad2(value: number): string {
  return Math.max(0, Math.floor(value)).toString().padStart(2, '0');
}

export function formatRealClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${pad2(totalSeconds / 60)}:${pad2(totalSeconds % 60)}`;
}

export function formatGameMinuteCountdown(gameMinutes: number): string {
  const minutes = Math.max(0, Math.ceil(gameMinutes));
  return `${pad2(minutes / 60)}:${pad2(minutes % 60)}`;
}

export function formatPercent(value: number): string {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

export const ROVER_STATUS_LABELS: Readonly<Record<RoverStatus, string>> = {
  IDLE_AT_BASE: 'На базе',
  IDLE_ON_MAP: 'Ожидает на карте',
  MOVING: 'В пути',
  DELAYED: 'Задержан бурей',
  BROKEN: 'Повреждён',
  STUCK: 'Застрял в кратере',
  REPAIRING: 'Выполняет ремонт',
  RESCUING: 'Проводит спасение',
  SELF_REPAIR: 'Саморемонт',
  OUT_OF_BATTERY: 'Батарея разряжена',
};

export const INCIDENT_LABELS: Readonly<Record<IncidentKind, string>> = {
  dustStorm: 'Пылевая буря',
  meteorite: 'Метеоритное повреждение',
  crater: 'Падение в кратер',
};

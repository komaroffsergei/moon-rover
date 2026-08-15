import type { GridCell } from './grid';

export const RADIO_EVENT_CODES = [
  'oxygen.50',
  'oxygen.25',
  'oxygen.10',
  'oxygen.5',
  'oxygen.1',
  'food.50',
  'food.25',
  'food.10',
  'food.5',
  'food.1',
  'recovery.30',
  'recovery.20',
  'recovery.10',
  'recovery.5',
  'recovery.1',
  'recovery.restored',
  'recovery.lost',
  'equipment.demand',
  'center.request.oxygen',
  'center.request.food',
  'center.request.equipment',
  'incident.dust.courier',
  'incident.dust.repair',
  'incident.dust.resolved',
  'incident.meteor.courier',
  'incident.meteor.repair',
  'incident.meteor.resolved',
  'incident.crater.courier',
  'incident.crater.repair',
  'incident.crater.resolved',
  'rover.arrived',
  'center.delivery.received',
  'rover.battery.empty',
  'rescue.repair.started',
  'rescue.repair.completed',
  'rescue.crater.started',
  'rescue.crater.completed',
  'rescue.battery.transferred',
  'system.shift.victory',
  'system.shift.defeat',
] as const;

export type RadioEventCode = (typeof RADIO_EVENT_CODES)[number];
export type RadioCategory =
  'INFO' | 'WARNING' | 'CRITICAL' | 'EVENT' | 'RESCUE' | 'SYSTEM';
export type RadioPriority = 0 | 1 | 2 | 3;
export type RadioSourceKind = 'CENTER' | 'ROVER' | 'EMERGENCY' | 'SYSTEM';

export const RADIO_ALLOWED_PLACEHOLDERS: Readonly<
  Partial<Record<RadioEventCode, readonly string[]>>
> = {
  'equipment.demand': ['amount'],
  'center.request.oxygen': ['amount'],
  'center.request.food': ['amount'],
  'center.request.equipment': ['amount'],
  'center.delivery.received': ['oxygen', 'food', 'equipment'],
  'rescue.battery.transferred': ['charge'],
};

export function hasUnexpectedRadioPlaceholder(
  eventCode: RadioEventCode,
  template: string,
): boolean {
  let remaining = template;
  for (const placeholder of RADIO_ALLOWED_PLACEHOLDERS[eventCode] ?? []) {
    remaining = remaining.replaceAll(`{${placeholder}}`, '');
  }
  return /[{}]/.test(remaining);
}

export interface RadioTemplateDefinition {
  category: RadioCategory;
  priority: RadioPriority;
  templates: readonly string[];
}

export type RadioTemplateMap = {
  [EventCode in RadioEventCode]: RadioTemplateDefinition;
};

export interface RadioCatalog {
  historyLimit: 100;
  messages: RadioTemplateMap;
}

export interface RadioMessage {
  id: string;
  eventCode: RadioEventCode;
  category: RadioCategory;
  priority: RadioPriority;
  text: string;
  objectId: string | null;
  cell: GridCell | null;
  sourceKind: RadioSourceKind;
  gameMinute: number;
}

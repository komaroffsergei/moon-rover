import {
  RADIO_EVENT_CODES,
  type DomainEvent,
  type GridCell,
  type IncidentKind,
  type RadioCatalog,
  type RadioEventCode,
  type RadioMessage,
  type RadioSourceKind,
  type RoverKind,
} from '../../domain';
import { formatGameQuantity } from '../../shared/formatGameQuantity';

interface RadioMapping {
  eventCode: RadioEventCode;
  objectId: string | null;
  cell: GridCell | null;
  sourceKind: RadioSourceKind;
  replacements?: Readonly<Record<string, string>>;
}

function supportedEventCode(value: string): RadioEventCode | null {
  return (RADIO_EVENT_CODES as readonly string[]).includes(value)
    ? (value as RadioEventCode)
    : null;
}

function incidentStartedEventCode(
  kind: IncidentKind,
  roverKind: RoverKind,
): RadioEventCode {
  if (kind === 'dustStorm') {
    return roverKind === 'courier'
      ? 'incident.dust.courier'
      : 'incident.dust.repair';
  }
  if (kind === 'meteorite') {
    return roverKind === 'courier'
      ? 'incident.meteor.courier'
      : 'incident.meteor.repair';
  }
  return roverKind === 'courier'
    ? 'incident.crater.courier'
    : 'incident.crater.repair';
}

function incidentResolvedEventCode(kind: IncidentKind): RadioEventCode {
  if (kind === 'dustStorm') return 'incident.dust.resolved';
  if (kind === 'meteorite') return 'incident.meteor.resolved';
  return 'incident.crater.resolved';
}

function mapEvent(event: DomainEvent): RadioMapping | null {
  switch (event.type) {
    case 'RESOURCE_THRESHOLD': {
      const eventCode = supportedEventCode(
        `${event.resource}.${event.threshold}`,
      );
      return eventCode === null
        ? null
        : {
            eventCode,
            objectId: event.centerId,
            cell: event.cell,
            sourceKind: 'CENTER',
          };
    }
    case 'CENTER_RECOVERY_STARTED':
      return null;
    case 'RECOVERY_THRESHOLD': {
      const eventCode = supportedEventCode(
        `recovery.${event.remainingGameMinutes}`,
      );
      return eventCode === null
        ? null
        : {
            eventCode,
            objectId: event.centerId,
            cell: event.cell,
            sourceKind: 'CENTER',
          };
    }
    case 'CENTER_RESTORED':
      return {
        eventCode: 'recovery.restored',
        objectId: event.centerId,
        cell: event.cell,
        sourceKind: 'CENTER',
      };
    case 'CENTER_LOST':
      return {
        eventCode: 'recovery.lost',
        objectId: event.centerId,
        cell: event.cell,
        sourceKind: 'CENTER',
      };
    case 'EQUIPMENT_DEMAND':
      return {
        eventCode: 'equipment.demand',
        objectId: event.centerId,
        cell: event.cell,
        sourceKind: 'CENTER',
        replacements: { amount: String(event.amount) },
      };
    case 'CENTER_DELIVERY_REQUESTED':
      return {
        eventCode: `center.request.${event.resource}`,
        objectId: event.centerId,
        cell: event.cell,
        sourceKind: 'CENTER',
        replacements: { amount: String(event.amount) },
      };
    case 'INCIDENT_STARTED':
      return {
        eventCode: incidentStartedEventCode(
          event.incidentKind,
          event.roverKind,
        ),
        objectId: event.roverId,
        cell: event.cell,
        sourceKind: 'ROVER',
      };
    case 'INCIDENT_RESOLVED':
      return {
        eventCode: incidentResolvedEventCode(event.incidentKind),
        objectId: event.roverId,
        cell: event.cell,
        sourceKind: 'ROVER',
      };
    case 'ROVER_ARRIVED':
      return {
        eventCode: 'rover.arrived',
        objectId: event.roverId,
        cell: event.cell,
        sourceKind: 'ROVER',
      };
    case 'CARGO_DELIVERED':
      return {
        eventCode: 'center.delivery.received',
        objectId: event.centerId,
        cell: event.cell,
        sourceKind: 'CENTER',
        replacements: {
          oxygen: formatGameQuantity(event.delivered.oxygen),
          food: formatGameQuantity(event.delivered.food),
          equipment: formatGameQuantity(event.delivered.equipment),
        },
      };
    case 'ROVER_OUT_OF_BATTERY':
      return {
        eventCode: 'rover.battery.empty',
        objectId: event.roverId,
        cell: event.cell,
        sourceKind: 'ROVER',
      };
    case 'EMERGENCY_OPERATION_STARTED':
      return {
        eventCode:
          event.operationKind === 'REPAIR'
            ? 'rescue.repair.started'
            : 'rescue.crater.started',
        objectId: event.helperRoverId,
        cell: event.cell,
        sourceKind: 'EMERGENCY',
      };
    case 'EMERGENCY_OPERATION_COMPLETED':
      return {
        eventCode:
          event.operationKind === 'REPAIR'
            ? 'rescue.repair.completed'
            : 'rescue.crater.completed',
        objectId: event.helperRoverId,
        cell: event.cell,
        sourceKind: 'EMERGENCY',
      };
    case 'BATTERY_TRANSFERRED':
      return {
        eventCode: 'rescue.battery.transferred',
        objectId: event.repairRoverId,
        cell: event.cell,
        sourceKind: 'EMERGENCY',
        replacements: { charge: String(event.transferredCharge) },
      };
    case 'SHIFT_ENDED':
      return {
        eventCode:
          event.outcome === 'VICTORY'
            ? 'system.shift.victory'
            : 'system.shift.defeat',
        objectId: null,
        cell: null,
        sourceKind: 'SYSTEM',
      };
  }
}

function renderTemplate(
  template: string,
  replacements: Readonly<Record<string, string>> = {},
): string {
  return Object.entries(replacements).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, value),
    template,
  );
}

function eventFingerprint(
  event: DomainEvent,
  eventCode: RadioEventCode,
): string {
  const location =
    'cell' in event ? `${event.cell.column},${event.cell.row}` : 'system';
  let detail: string;
  switch (event.type) {
    case 'RESOURCE_THRESHOLD':
      detail = `${event.centerId}|${event.resource}|${event.threshold}`;
      break;
    case 'CENTER_RECOVERY_STARTED':
    case 'CENTER_RESTORED':
    case 'CENTER_LOST':
      detail = event.centerId;
      break;
    case 'RECOVERY_THRESHOLD':
      detail = `${event.centerId}|${event.remainingGameMinutes}`;
      break;
    case 'EQUIPMENT_DEMAND':
      detail = `${event.centerId}|${event.amount}`;
      break;
    case 'CENTER_DELIVERY_REQUESTED':
      detail = `${event.centerId}|${event.resource}|${event.amount}`;
      break;
    case 'INCIDENT_STARTED':
      detail = `${event.roverId}|${event.roverKind}|${event.incidentKind}`;
      break;
    case 'INCIDENT_RESOLVED':
      detail = `${event.roverId}|${event.incidentKind}`;
      break;
    case 'ROVER_ARRIVED':
    case 'ROVER_OUT_OF_BATTERY':
      detail = event.roverId;
      break;
    case 'CARGO_DELIVERED':
      detail = `${event.roverId}|${event.centerId}|${event.delivered.oxygen}|${event.delivered.food}|${event.delivered.equipment}`;
      break;
    case 'EMERGENCY_OPERATION_STARTED':
      detail = `${event.operationKind}|${event.helperRoverId}|${event.targetRoverId}|${event.durationGameMinutes}`;
      break;
    case 'EMERGENCY_OPERATION_COMPLETED':
      detail = `${event.operationKind}|${event.helperRoverId}|${event.targetRoverId}`;
      break;
    case 'BATTERY_TRANSFERRED':
      detail = `${event.donorRoverId}|${event.repairRoverId}|${event.transferredCharge}|${event.discardedCharge}`;
      break;
    case 'SHIFT_ENDED':
      detail = event.outcome;
      break;
  }
  return `${eventCode}|${detail}|${event.gameMinute}|${location}`;
}

export function formatRadioEvent(
  event: DomainEvent,
  catalog: RadioCatalog,
): RadioMessage | null {
  const mapping = mapEvent(event);
  if (mapping === null) return null;
  const definition = catalog.messages[mapping.eventCode];
  const template = definition.templates[0];
  if (template === undefined) {
    throw new Error(`Radio template ${mapping.eventCode} отсутствует`);
  }
  return {
    id: eventFingerprint(event, mapping.eventCode),
    eventCode: mapping.eventCode,
    category: definition.category,
    priority: definition.priority,
    text: renderTemplate(template, mapping.replacements),
    objectId: mapping.objectId,
    cell: mapping.cell === null ? null : { ...mapping.cell },
    sourceKind: mapping.sourceKind,
    gameMinute: event.gameMinute,
  };
}

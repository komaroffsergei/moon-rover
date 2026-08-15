import type { DomainEvent, RadioCatalog, RadioMessage } from '../../domain';
import { formatRadioEvent } from './formatRadioEvent';

export interface RadioJournal {
  ingest(events: readonly DomainEvent[]): void;
  getMessages(): readonly RadioMessage[];
}

function freezeMessage(message: RadioMessage): RadioMessage {
  return Object.freeze({
    ...message,
    cell: message.cell === null ? null : Object.freeze({ ...message.cell }),
  });
}

interface EventCorrelation {
  key: string;
  preferred: boolean;
}

interface JournalEntry {
  message: RadioMessage;
  correlation: EventCorrelation | null;
}

function eventCorrelation(event: DomainEvent): EventCorrelation | null {
  if (event.type === 'ROVER_ARRIVED') {
    return {
      key: JSON.stringify(['arrival', event.roverId, event.gameMinute]),
      preferred: false,
    };
  }
  if (event.type === 'CARGO_DELIVERED') {
    return {
      key: JSON.stringify(['arrival', event.roverId, event.gameMinute]),
      preferred: true,
    };
  }
  if (event.type === 'INCIDENT_RESOLVED') {
    const operationKind =
      event.incidentKind === 'meteorite'
        ? 'REPAIR'
        : event.incidentKind === 'crater'
          ? 'RESCUE'
          : null;
    return operationKind === null
      ? null
      : {
          key: JSON.stringify([
            'incident',
            operationKind,
            event.roverId,
            event.gameMinute,
          ]),
          preferred: false,
        };
  }
  if (event.type === 'EMERGENCY_OPERATION_COMPLETED') {
    return {
      key: JSON.stringify([
        'incident',
        event.operationKind,
        event.targetRoverId,
        event.gameMinute,
      ]),
      preferred: true,
    };
  }
  if (event.type === 'ROVER_OUT_OF_BATTERY') {
    return {
      key: JSON.stringify(['battery', event.roverId, event.gameMinute]),
      preferred: false,
    };
  }
  if (event.type === 'BATTERY_TRANSFERRED') {
    return {
      key: JSON.stringify(['battery', event.donorRoverId, event.gameMinute]),
      preferred: true,
    };
  }
  return null;
}

export function createRadioJournal(catalog: RadioCatalog): RadioJournal {
  if (catalog.historyLimit !== 100) {
    throw new RangeError('radioCatalog.historyLimit должен быть равен 100');
  }
  const immutableCatalog = structuredClone(catalog);
  const entries: JournalEntry[] = [];

  return {
    ingest(events) {
      for (const event of events) {
        const formatted = formatRadioEvent(event, immutableCatalog);
        if (formatted === null) continue;
        const correlation = eventCorrelation(event);
        const correlatedIndex =
          correlation === null
            ? -1
            : entries.findIndex(
                (entry) => entry.correlation?.key === correlation.key,
              );
        if (correlatedIndex >= 0 && correlation !== null) {
          const existing = entries[correlatedIndex];
          if (existing === undefined) continue;
          if (existing.correlation?.preferred && correlation.preferred) {
            // Разные успешные доставки могут совпасть по роверу и минуте.
            // Настоящие дубликаты отсекает стабильный fingerprint сообщения.
          } else {
            if (existing.correlation?.preferred || !correlation.preferred) {
              continue;
            }
            entries.splice(correlatedIndex, 1);
          }
        }
        if (entries.some(({ message }) => message.id === formatted.id)) {
          continue;
        }
        const message = freezeMessage(formatted);
        entries.unshift({ message, correlation });
        if (entries.length > immutableCatalog.historyLimit) {
          entries.length = immutableCatalog.historyLimit;
        }
      }
    },
    getMessages() {
      return entries.map(({ message }) => freezeMessage(message));
    },
  };
}

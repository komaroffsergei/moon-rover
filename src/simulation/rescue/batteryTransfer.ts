import type { CommandResult, DomainEvent, GridCell } from '../../domain';
import { isCardinalNeighbor, sameCell } from '../rovers/cells';
import type { MutableRoverState } from '../types';
import type { MutableEmergencyOperation } from './types';

export interface BatteryTransferForecast {
  donorBatteryAfter: 0;
  repairBatteryAfter: number;
  discardedCharge: number;
}

function assertBatteryValue(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} должен быть конечным и неотрицательным`);
  }
}

export function forecastBatteryTransfer(
  donorBattery: number,
  repairBatteryCapacity: number,
): BatteryTransferForecast {
  assertBatteryValue('donorBattery', donorBattery);
  if (!Number.isFinite(repairBatteryCapacity) || repairBatteryCapacity <= 0) {
    throw new RangeError(
      'repairBatteryCapacity должен быть положительным конечным числом',
    );
  }
  const repairBatteryAfter = Math.min(donorBattery, repairBatteryCapacity);
  return {
    donorBatteryAfter: 0,
    repairBatteryAfter,
    discardedCharge: donorBattery - repairBatteryAfter,
  };
}

function operationIncludes(
  operations: readonly MutableEmergencyOperation[],
  roverId: string,
): boolean {
  return operations.some(
    ({ helperRoverId, targetRoverId }) =>
      helperRoverId === roverId || targetRoverId === roverId,
  );
}

function readyStatus(rover: MutableRoverState, baseCell: GridCell) {
  if (rover.route !== null) return 'MOVING' as const;
  return sameCell(rover.cell, baseCell)
    ? ('IDLE_AT_BASE' as const)
    : ('IDLE_ON_MAP' as const);
}

export function confirmBatteryTransfer(
  rovers: readonly MutableRoverState[],
  operations: readonly MutableEmergencyOperation[],
  donorRoverId: string,
  repairRoverId: string,
  baseCell: GridCell,
  gameMinute: number,
): CommandResult {
  const donor = rovers.find(({ id }) => id === donorRoverId);
  const receiver = rovers.find(({ id }) => id === repairRoverId);
  if (donor === undefined || receiver === undefined) {
    return { ok: false, code: 'ROVER_NOT_FOUND' };
  }
  if (
    operationIncludes(operations, donor.id) ||
    operationIncludes(operations, receiver.id)
  ) {
    return { ok: false, code: 'ROVER_UNAVAILABLE' };
  }
  if (receiver.kind !== 'repair') {
    return { ok: false, code: 'BATTERY_RECIPIENT_INVALID' };
  }
  if (donor.kind !== 'courier') {
    return { ok: false, code: 'BATTERY_DONOR_INVALID' };
  }
  if (receiver.battery !== 0) {
    return { ok: false, code: 'REPAIR_BATTERY_NOT_EMPTY' };
  }
  if (donor.battery <= 0) {
    return { ok: false, code: 'DONOR_BATTERY_EMPTY' };
  }
  const donorIsIdle =
    donor.status === 'IDLE_AT_BASE' || donor.status === 'IDLE_ON_MAP';
  if (
    !donorIsIdle ||
    donor.activeIncident !== null ||
    receiver.status !== 'OUT_OF_BATTERY' ||
    receiver.activeIncident !== null
  ) {
    return { ok: false, code: 'ROVER_UNAVAILABLE' };
  }
  if (!isCardinalNeighbor(donor.cell, receiver.cell)) {
    return { ok: false, code: 'ROVER_OUT_OF_RANGE' };
  }

  const forecast = forecastBatteryTransfer(
    donor.battery,
    receiver.batteryCapacity,
  );
  donor.battery = forecast.donorBatteryAfter;
  donor.status = 'OUT_OF_BATTERY';
  receiver.battery = forecast.repairBatteryAfter;
  receiver.status = readyStatus(receiver, baseCell);
  const events: DomainEvent[] = [
    {
      type: 'BATTERY_TRANSFERRED',
      donorRoverId: donor.id,
      repairRoverId: receiver.id,
      transferredCharge: forecast.repairBatteryAfter,
      discardedCharge: forecast.discardedCharge,
      cell: { ...receiver.cell },
      gameMinute,
    },
    {
      type: 'ROVER_OUT_OF_BATTERY',
      roverId: donor.id,
      cell: { ...donor.cell },
      gameMinute,
    },
  ];
  return {
    ok: true,
    events,
  };
}

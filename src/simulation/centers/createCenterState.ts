import type {
  CenterDefinition,
  CenterRules,
  CenterStatus,
  EquipmentDemandConfig,
} from '../../domain';
import type { MutableCenterState, MutableResourceState } from '../types';

function createResource(
  definition: CenterDefinition['oxygen'],
): MutableResourceState {
  return {
    ...definition,
    current: definition.initial,
    emittedThresholds: new Set(),
  };
}

export function workingStatus(
  center: Pick<MutableCenterState, 'oxygen' | 'food' | 'equipment'>,
  rules: CenterRules,
): CenterStatus {
  const minimum = Math.min(
    center.oxygen.current,
    center.food.current,
    center.equipment,
  );
  return minimum > rules.warningThreshold ? 'WORKING' : 'WARNING';
}

export function createCenterState(
  definition: CenterDefinition,
  rules: CenterRules,
  demand: EquipmentDemandConfig,
  equipmentDemandEnabled = true,
): MutableCenterState {
  const state: MutableCenterState = {
    id: definition.id,
    name: definition.name,
    cell: { ...definition.cell },
    status: 'WORKING',
    oxygen: createResource(definition.oxygen),
    food: createResource(definition.food),
    equipment: definition.equipmentInitial,
    equipmentCapacity: definition.equipmentCapacity,
    recoveryRemainingGameMinutes: null,
    emittedRecoveryThresholds: new Set(),
    nextEquipmentDemandGameMinute: equipmentDemandEnabled
      ? demand.firstEligibleGameMinute
      : Number.POSITIVE_INFINITY,
  };
  state.status = workingStatus(state, rules);
  return state;
}

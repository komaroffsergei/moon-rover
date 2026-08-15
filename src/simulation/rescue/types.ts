import type { EmergencyOperationKind } from '../../domain';

export interface MutableEmergencyOperation {
  kind: EmergencyOperationKind;
  helperRoverId: string;
  targetRoverId: string;
  remainingGameMinutes: number;
}

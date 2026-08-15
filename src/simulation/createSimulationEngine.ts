import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';

import {
  addRealTime,
  canConsumeFixedStep,
  consumeFixedStep,
  createFixedStepClock,
  fixedStepGameMinutes,
  gameMinutesAt,
  roundGameValue,
  type FixedStepClock,
} from './clock/fixedStepClock';
import { createCenterState } from './centers/createCenterState';
import { createInitialDeliveryRequests } from './centers/createDeliveryRequests';
import { chargeRover } from './battery/chargeRover';
import { exceedsCargoCapacity, hasCargo, isValidCargo } from './cargo/cargo';
import { setRoverCargo } from './cargo/setRoverCargo';
import { unloadRoverCargo } from './cargo/unloadRoverCargo';
import { createDemandRandom } from './centers/equipmentDemand';
import { stepCenter } from './centers/stepCenters';
import { evaluateOutcome } from './outcomes/evaluateOutcome';
import { createRoverState, snapshotRover } from './rovers/createRoverState';
import { applyArrivalEffects } from './rovers/applyArrivalEffects';
import { sameCell } from './rovers/cells';
import {
  createIncidentRandomStreams,
  type IncidentRandomStreams,
} from './incidents/incidentRandom';
import { stepRover } from './movement/stepRover';
import {
  beginAutomaticRoverRepairAfterArrival,
  beginCraterRescue,
  beginRoverRepair,
  stepEmergencyOperations,
} from './rescue/emergencyOperations';
import { confirmBatteryTransfer } from './rescue/batteryTransfer';
import type { MutableEmergencyOperation } from './rescue/types';
import {
  createRadioJournal,
  type RadioJournal,
} from './radio/createRadioJournal';
import { appendRouteStep, createRouteDraft } from './routing/routeDraft';
import { confirmRouteDraft } from './routing/confirmRouteDraft';
import { createNavigationRoute } from './routing/createNavigationRoute';
import { findNavigationRoute } from './routing/findNavigationRoute';
import { calculateCellTravelGameMinutes } from './routing/forecastRoute';
import type {
  CenterSnapshot,
  CommandResult,
  DomainEvent,
  GameCommand,
  GameSnapshot,
  GridCell,
  ShiftPhase,
  SimulationConfig,
} from '../domain';
import { hasUnexpectedRadioPlaceholder, RADIO_EVENT_CODES } from '../domain';
import type {
  MutableCenterState,
  MutableRoverState,
  SimulationEngine,
} from './types';

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} должен быть положительным конечным числом`);
  }
}

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} должен быть конечным и неотрицательным`);
  }
}

function assertDescendingPositive(name: string, values: readonly number[]) {
  if (
    values.length === 0 ||
    values.some(
      (value, index) =>
        !Number.isFinite(value) ||
        value <= 0 ||
        (index > 0 && value >= values[index - 1]!),
    )
  ) {
    throw new RangeError(`${name} должен строго убывать и содержать > 0`);
  }
}

function assertGridCell(name: string, cell: GridCell): void {
  if (
    !Number.isInteger(cell.column) ||
    cell.column < 0 ||
    !Number.isInteger(cell.row) ||
    cell.row < 0
  ) {
    throw new RangeError(`${name} должен быть неотрицательной целой клеткой`);
  }
}

function isCellInsideMap(cell: GridCell, config: SimulationConfig): boolean {
  return (
    cell.column >= 0 &&
    cell.column < config.routingMap.width &&
    cell.row >= 0 &&
    cell.row < config.routingMap.height
  );
}

function assertWalkableMapCell(
  name: string,
  cell: GridCell,
  config: SimulationConfig,
): void {
  if (!isCellInsideMap(cell, config)) {
    throw new RangeError(`${name} находится вне routingMap`);
  }
  const routingCell =
    config.routingMap.cells[cell.row * config.routingMap.width + cell.column];
  if (routingCell?.walkable !== true) {
    throw new RangeError(`${name} должен находиться в walkable клетке`);
  }
}

function validateConfig(config: SimulationConfig): void {
  if (config.seed.trim().length === 0) {
    throw new RangeError('seed не должен быть пустым');
  }
  assertPositive('fixedStepMilliseconds', config.time.fixedStepMilliseconds);
  assertPositive(
    'gameMinutesPerRealSecond',
    config.time.gameMinutesPerRealSecond,
  );
  assertPositive('shiftRealSeconds', config.time.shiftRealSeconds);
  assertPositive('routeWeights.movementCost', config.routeWeights.movementCost);
  assertNonNegative(
    'routeWeights.incidentRisk',
    config.routeWeights.incidentRisk,
  );
  assertPositive('recoveryGameMinutes', config.centerRules.recoveryGameMinutes);
  assertNonNegative('warningThreshold', config.centerRules.warningThreshold);
  assertDescendingPositive(
    'radioThresholds',
    config.centerRules.radioThresholds,
  );
  assertDescendingPositive(
    'recoveryRadioThresholds',
    config.centerRules.recoveryRadioThresholds,
  );
  assertNonNegative(
    'firstEligibleGameMinute',
    config.equipmentDemand.firstEligibleGameMinute,
  );
  assertPositive(
    'minimumIntervalGameMinutes',
    config.equipmentDemand.minimumIntervalGameMinutes,
  );
  if (
    !Number.isInteger(config.equipmentDemand.lossMin) ||
    !Number.isInteger(config.equipmentDemand.lossMax) ||
    config.equipmentDemand.lossMin <= 0 ||
    config.equipmentDemand.lossMax < config.equipmentDemand.lossMin
  ) {
    throw new RangeError('Диапазон equipment demand некорректен');
  }
  if (config.centers.length === 0) {
    throw new RangeError('Нужен хотя бы один центр');
  }
  if (
    !Number.isInteger(config.routingMap.width) ||
    config.routingMap.width <= 0 ||
    !Number.isInteger(config.routingMap.height) ||
    config.routingMap.height <= 0 ||
    config.routingMap.cells.length !==
      config.routingMap.width * config.routingMap.height
  ) {
    throw new RangeError(
      'routingMap должен иметь положительные размеры и width × height клеток',
    );
  }
  config.routingMap.cells.forEach((cell, index) => {
    if (
      typeof cell.walkable !== 'boolean' ||
      !Number.isFinite(cell.movementCost) ||
      cell.movementCost <= 0 ||
      !Number.isFinite(cell.effectiveCellChance) ||
      cell.effectiveCellChance < 0 ||
      cell.effectiveCellChance > 1 ||
      cell.incidentProfileId.trim().length === 0
    ) {
      throw new RangeError(`routingMap.cells[${index}] некорректна`);
    }
  });
  if (
    !Number.isInteger(config.incidentRules.eventCooldownCells) ||
    config.incidentRules.eventCooldownCells < 0
  ) {
    throw new RangeError(
      'eventCooldownCells должен быть целым и неотрицательным',
    );
  }
  assertPositive(
    'dustStormGameMinutes',
    config.incidentRules.dustStormGameMinutes,
  );
  assertPositive(
    'selfRepairGameMinutes',
    config.incidentRules.selfRepairGameMinutes,
  );
  assertPositive('repairGameMinutes', config.rescueRules.repairGameMinutes);
  assertPositive(
    'craterRescueGameMinutes',
    config.rescueRules.craterRescueGameMinutes,
  );
  if (config.radioCatalog.historyLimit !== 100) {
    throw new RangeError('radioCatalog.historyLimit должен быть равен 100');
  }
  const radioEventCodeSet = new Set<string>(RADIO_EVENT_CODES);
  const radioKeys = Object.keys(config.radioCatalog.messages);
  if (
    radioKeys.length !== RADIO_EVENT_CODES.length ||
    radioKeys.some((eventCode) => !radioEventCodeSet.has(eventCode))
  ) {
    throw new RangeError('radioCatalog содержит неполный набор eventCode');
  }
  for (const eventCode of RADIO_EVENT_CODES) {
    const definition = config.radioCatalog.messages[eventCode];
    if (
      !['INFO', 'WARNING', 'CRITICAL', 'EVENT', 'RESCUE', 'SYSTEM'].includes(
        definition.category,
      ) ||
      ![0, 1, 2, 3].includes(definition.priority) ||
      definition.templates.length === 0 ||
      definition.templates.some(
        (template) =>
          template.trim().length === 0 ||
          template.length > 180 ||
          hasUnexpectedRadioPlaceholder(eventCode, template),
      )
    ) {
      throw new RangeError(`radioCatalog.${eventCode} некорректен`);
    }
  }
  if (config.incidentRules.profiles.length === 0) {
    throw new RangeError('Нужен хотя бы один incident profile');
  }
  const incidentProfileIds = new Set<string>();
  for (const profile of config.incidentRules.profiles) {
    const weightTotal =
      profile.weights.dustStorm +
      profile.weights.meteorite +
      profile.weights.crater;
    if (
      profile.id.trim().length === 0 ||
      incidentProfileIds.has(profile.id) ||
      !Number.isFinite(profile.cellChance) ||
      profile.cellChance < 0 ||
      profile.cellChance > 1 ||
      !Object.values(profile.weights).every(
        (weight) => Number.isFinite(weight) && weight >= 0,
      ) ||
      !Number.isFinite(weightTotal) ||
      weightTotal <= 0
    ) {
      throw new RangeError(`Incident profile ${profile.id} некорректен`);
    }
    incidentProfileIds.add(profile.id);
  }
  config.routingMap.cells.forEach((cell, index) => {
    const profile = config.incidentRules.profiles.find(
      ({ id }) => id === cell.incidentProfileId,
    );
    if (
      profile === undefined ||
      profile.cellChance !== cell.effectiveCellChance
    ) {
      throw new RangeError(
        `routingMap.cells[${index}] incident profile не совпадает`,
      );
    }
  });
  assertGridCell('baseCell', config.baseCell);
  assertWalkableMapCell('baseCell', config.baseCell, config);
  const ids = new Set<string>();
  for (const center of config.centers) {
    if (center.id.trim().length === 0) {
      throw new RangeError('Center id не должен быть пустым');
    }
    if (ids.has(center.id))
      throw new RangeError(`Center id ${center.id} повторяется`);
    ids.add(center.id);
    assertGridCell(`${center.id}.cell`, center.cell);
    assertWalkableMapCell(`${center.id}.cell`, center.cell, config);
    for (const [name, resource] of [
      ['oxygen', center.oxygen],
      ['food', center.food],
    ] as const) {
      assertPositive(`${center.id}.${name}.capacity`, resource.capacity);
      assertPositive(
        `${center.id}.${name}.depletionGameMinutes`,
        resource.depletionGameMinutes,
      );
      if (
        !Number.isFinite(resource.initial) ||
        resource.initial <= 0 ||
        resource.initial > resource.capacity
      ) {
        throw new RangeError(`${center.id}.${name}.initial вне capacity`);
      }
    }
    assertPositive(`${center.id}.equipmentCapacity`, center.equipmentCapacity);
    if (
      !Number.isFinite(center.equipmentInitial) ||
      center.equipmentInitial <= 0 ||
      center.equipmentInitial > center.equipmentCapacity
    ) {
      throw new RangeError(`${center.id}.equipmentInitial вне capacity`);
    }
  }
  if (config.equipmentDemandCenterIds !== undefined) {
    const equipmentDemandIds = new Set<string>();
    for (const id of config.equipmentDemandCenterIds) {
      if (
        typeof id !== 'string' ||
        id.trim().length === 0 ||
        equipmentDemandIds.has(id) ||
        !ids.has(id)
      ) {
        throw new RangeError(
          `Equipment demand center id ${String(id)} некорректен`,
        );
      }
      equipmentDemandIds.add(id);
    }
  }
  if (config.rovers.length === 0) {
    throw new RangeError('Нужен хотя бы один rover');
  }
  const roverIds = new Set<string>();
  for (const rover of config.rovers) {
    if (rover.id.trim().length === 0 || roverIds.has(rover.id)) {
      throw new RangeError(`Rover id ${rover.id} пуст или повторяется`);
    }
    roverIds.add(rover.id);
    assertGridCell(`${rover.id}.initialCell`, rover.initialCell);
    assertWalkableMapCell(`${rover.id}.initialCell`, rover.initialCell, config);
    assertNonNegative(`${rover.id}.cargoCapacity`, rover.cargoCapacity);
    assertPositive(`${rover.id}.batteryCapacity`, rover.batteryCapacity);
    assertNonNegative(`${rover.id}.batteryInitial`, rover.batteryInitial);
    if (rover.batteryInitial > rover.batteryCapacity) {
      throw new RangeError(`${rover.id}.batteryInitial вне capacity`);
    }
    assertPositive(
      `${rover.id}.gameMinutesPerNormalCell`,
      rover.gameMinutesPerNormalCell,
    );
    assertPositive(
      `${rover.id}.batteryCostMultiplier`,
      rover.batteryCostMultiplier,
    );
    if (!isValidCargo(rover.initialCargo)) {
      throw new RangeError(`${rover.id}.initialCargo некорректен`);
    }
    if (exceedsCargoCapacity(rover.initialCargo, rover.cargoCapacity)) {
      throw new RangeError(`${rover.id}.initialCargo превышает capacity`);
    }
    if (
      rover.kind === 'repair' &&
      (rover.cargoCapacity !== 0 || hasCargo(rover.initialCargo))
    ) {
      throw new RangeError(`Repair rover ${rover.id} не может иметь cargo`);
    }
    if (rover.kind === 'courier' && rover.cargoCapacity <= 0) {
      throw new RangeError(`Courier rover ${rover.id} должен иметь capacity`);
    }
  }
}

function snapshotCenter(center: MutableCenterState): CenterSnapshot {
  const oxygen = roundGameValue(center.oxygen.current);
  const food = roundGameValue(center.food.current);
  const depletionForecastGameMinutes = roundGameValue(
    Math.min(
      (Math.max(0, oxygen) / center.oxygen.capacity) *
        center.oxygen.depletionGameMinutes,
      (Math.max(0, food) / center.food.capacity) *
        center.food.depletionGameMinutes,
    ),
  );
  return {
    id: center.id,
    name: center.name,
    cell: { ...center.cell },
    status: center.status,
    resources: {
      oxygen,
      food,
      equipment: roundGameValue(center.equipment),
    },
    depletionForecastGameMinutes,
    recoveryRemainingGameMinutes: center.recoveryRemainingGameMinutes,
  };
}

class Engine implements SimulationEngine {
  readonly #config: SimulationConfig;
  readonly #clock: FixedStepClock = createFixedStepClock();
  readonly #centers: MutableCenterState[];
  readonly #rovers: MutableRoverState[];
  readonly #randomByCenterId: ReadonlyMap<string, RandomGenerator>;
  readonly #incidentRandomByRoverId: ReadonlyMap<string, IncidentRandomStreams>;
  readonly #incidentProfiles: ReadonlyMap<
    string,
    SimulationConfig['incidentRules']['profiles'][number]
  >;
  readonly #radioJournal: RadioJournal;
  readonly #emergencyOperations: MutableEmergencyOperation[] = [];
  #phase: ShiftPhase = 'BRIEFING';

  constructor(config: SimulationConfig) {
    validateConfig(config);
    this.#config = structuredClone(config);
    const equipmentDemandCenterIds =
      this.#config.equipmentDemandCenterIds === undefined
        ? undefined
        : new Set(this.#config.equipmentDemandCenterIds);
    this.#centers = this.#config.centers.map((center) =>
      createCenterState(
        center,
        this.#config.centerRules,
        this.#config.equipmentDemand,
        equipmentDemandCenterIds?.has(center.id) ?? true,
      ),
    );
    this.#rovers = this.#config.rovers.map((rover) =>
      createRoverState(rover, this.#config.baseCell),
    );
    this.#randomByCenterId = new Map(
      this.#centers.map((center) => [
        center.id,
        createDemandRandom(`${this.#config.seed}:${center.id}`),
      ]),
    );
    this.#incidentRandomByRoverId = new Map(
      this.#rovers.map((rover) => [
        rover.id,
        createIncidentRandomStreams(this.#config.seed, rover.id),
      ]),
    );
    this.#incidentProfiles = new Map(
      this.#config.incidentRules.profiles.map((profile) => [
        profile.id,
        profile,
      ]),
    );
    this.#radioJournal = createRadioJournal(this.#config.radioCatalog);
  }

  getSnapshot(): GameSnapshot {
    const shiftMilliseconds = this.#config.time.shiftRealSeconds * 1_000;
    return {
      phase: this.#phase,
      elapsedRealMilliseconds: this.#clock.elapsedRealMilliseconds,
      elapsedGameMinutes: gameMinutesAt(
        this.#clock.elapsedRealMilliseconds,
        this.#config.time,
      ),
      remainingRealMilliseconds: Math.max(
        0,
        shiftMilliseconds - this.#clock.elapsedRealMilliseconds,
      ),
      centers: this.#centers.map(snapshotCenter),
      rovers: this.#rovers.map(snapshotRover),
      emergencyOperations: this.#emergencyOperations.map((operation) =>
        Object.freeze({ ...operation }),
      ),
      radioMessages: this.#radioJournal.getMessages(),
    };
  }

  #recordCommandResult(result: CommandResult): CommandResult {
    if (result.ok) this.#radioJournal.ingest(result.events);
    return result;
  }

  dispatch(command: GameCommand): CommandResult {
    switch (command.type) {
      case 'START_SHIFT':
        if (this.#phase !== 'BRIEFING') {
          return { ok: false, code: 'INVALID_PHASE' };
        }
        this.#phase = 'RUNNING';
        return this.#recordCommandResult({
          ok: true,
          events: createInitialDeliveryRequests(this.#centers),
        });
      case 'PAUSE_SHIFT':
        if (this.#phase !== 'RUNNING') {
          return { ok: false, code: 'INVALID_PHASE' };
        }
        this.#phase = 'PAUSED';
        return { ok: true, events: [] };
      case 'RESUME_SHIFT':
        if (this.#phase !== 'PAUSED') {
          return { ok: false, code: 'INVALID_PHASE' };
        }
        this.#phase = 'RUNNING';
        return { ok: true, events: [] };
      case 'SET_ROVER_CARGO': {
        if (!['BRIEFING', 'RUNNING', 'PAUSED'].includes(this.#phase)) {
          return { ok: false, code: 'INVALID_PHASE' };
        }
        const rover = this.#rovers.find(({ id }) => id === command.roverId);
        if (rover === undefined) return { ok: false, code: 'ROVER_NOT_FOUND' };
        if (!['IDLE_AT_BASE', 'IDLE_ON_MAP'].includes(rover.status)) {
          return { ok: false, code: 'ROVER_UNAVAILABLE' };
        }
        return setRoverCargo(rover, command.cargo, this.#config.baseCell);
      }
      case 'UNLOAD_ROVER_CARGO': {
        if (!['RUNNING', 'PAUSED'].includes(this.#phase)) {
          return { ok: false, code: 'SHIFT_NOT_ACTIVE' };
        }
        const rover = this.#rovers.find(({ id }) => id === command.roverId);
        if (rover === undefined) return { ok: false, code: 'ROVER_NOT_FOUND' };
        if (
          this.#emergencyOperations.some(
            ({ helperRoverId, targetRoverId }) =>
              helperRoverId === rover.id || targetRoverId === rover.id,
          )
        ) {
          return { ok: false, code: 'ROVER_UNAVAILABLE' };
        }
        if (rover.activeIncident !== null) {
          return { ok: false, code: 'ROVER_UNAVAILABLE' };
        }
        const center = this.#centers.find(({ id }) => id === command.centerId);
        if (center === undefined)
          return { ok: false, code: 'CENTER_NOT_FOUND' };
        return this.#recordCommandResult(
          unloadRoverCargo(
            rover,
            center,
            gameMinutesAt(
              this.#clock.elapsedRealMilliseconds,
              this.#config.time,
            ),
            this.#config.centerRules,
          ),
        );
      }
      case 'CHARGE_ROVER': {
        if (!['BRIEFING', 'RUNNING', 'PAUSED'].includes(this.#phase)) {
          return { ok: false, code: 'INVALID_PHASE' };
        }
        const rover = this.#rovers.find(({ id }) => id === command.roverId);
        if (rover === undefined) return { ok: false, code: 'ROVER_NOT_FOUND' };
        if (
          this.#emergencyOperations.some(
            ({ helperRoverId, targetRoverId }) =>
              helperRoverId === rover.id || targetRoverId === rover.id,
          )
        ) {
          return { ok: false, code: 'ROVER_UNAVAILABLE' };
        }
        if (rover.activeIncident !== null || rover.status === 'MOVING') {
          return { ok: false, code: 'ROVER_UNAVAILABLE' };
        }
        return chargeRover(rover, this.#config.baseCell);
      }
      case 'START_ROVER_REPAIR': {
        if (!['RUNNING', 'PAUSED'].includes(this.#phase)) {
          return { ok: false, code: 'SHIFT_NOT_ACTIVE' };
        }
        return this.#recordCommandResult(
          beginRoverRepair(
            this.#rovers,
            this.#emergencyOperations,
            command.repairRoverId,
            command.targetRoverId,
            this.#config.rescueRules,
            gameMinutesAt(
              this.#clock.elapsedRealMilliseconds,
              this.#config.time,
            ),
          ),
        );
      }
      case 'START_CRATER_RESCUE': {
        if (!['RUNNING', 'PAUSED'].includes(this.#phase)) {
          return { ok: false, code: 'SHIFT_NOT_ACTIVE' };
        }
        return this.#recordCommandResult(
          beginCraterRescue(
            this.#rovers,
            this.#emergencyOperations,
            command.rescuerRoverId,
            command.targetRoverId,
            this.#config.rescueRules,
            gameMinutesAt(
              this.#clock.elapsedRealMilliseconds,
              this.#config.time,
            ),
          ),
        );
      }
      case 'CONFIRM_BATTERY_TRANSFER': {
        if (!['RUNNING', 'PAUSED'].includes(this.#phase)) {
          return { ok: false, code: 'SHIFT_NOT_ACTIVE' };
        }
        return this.#recordCommandResult(
          confirmBatteryTransfer(
            this.#rovers,
            this.#emergencyOperations,
            command.donorRoverId,
            command.repairRoverId,
            this.#config.baseCell,
            gameMinutesAt(
              this.#clock.elapsedRealMilliseconds,
              this.#config.time,
            ),
          ),
        );
      }
      case 'ASSIGN_ROVER_ROUTE': {
        if (!['RUNNING', 'PAUSED'].includes(this.#phase)) {
          return { ok: false, code: 'SHIFT_NOT_ACTIVE' };
        }
        const rover = this.#rovers.find(({ id }) => id === command.roverId);
        if (rover === undefined) return { ok: false, code: 'ROVER_NOT_FOUND' };
        if (!['IDLE_AT_BASE', 'IDLE_ON_MAP', 'MOVING'].includes(rover.status)) {
          return { ok: false, code: 'ROVER_UNAVAILABLE' };
        }
        if (
          rover.status === 'MOVING' &&
          rover.route?.mode === 'FREE_NAVIGATION'
        ) {
          return { ok: false, code: 'ROVER_UNAVAILABLE' };
        }

        const currentTarget = rover.route?.steps[rover.routeStepIndex];
        const preserveCurrentEntry =
          rover.status === 'MOVING' &&
          rover.stepElapsedGameMinutes > 0 &&
          currentTarget !== undefined;
        if (
          preserveCurrentEntry &&
          (command.steps[0] === undefined ||
            !sameCell(command.steps[0], currentTarget))
        ) {
          return { ok: false, code: 'ROUTE_INVALID' };
        }

        let draft = createRouteDraft(rover.cell);
        for (const step of command.steps) {
          const appended = appendRouteStep(
            draft,
            step,
            this.#config.routingMap,
          );
          if (!appended.ok) return { ok: false, code: 'ROUTE_INVALID' };
          draft = appended.draft;
        }
        const currentStepDuration =
          preserveCurrentEntry && currentTarget !== undefined
            ? calculateCellTravelGameMinutes(
                this.#config.routingMap.cells[
                  currentTarget.row * this.#config.routingMap.width +
                    currentTarget.column
                ]?.movementCost ?? 0,
                rover.gameMinutesPerNormalCell,
              )
            : 0;
        const confirmed = confirmRouteDraft(
          draft,
          this.#config.routingMap,
          {
            gameMinutesPerNormalCell: rover.gameMinutesPerNormalCell,
            batteryCostMultiplier: rover.batteryCostMultiplier,
            currentBattery: rover.battery,
            firstStepProgress:
              currentStepDuration > 0
                ? Math.min(
                    1,
                    rover.stepElapsedGameMinutes / currentStepDuration,
                  )
                : 0,
          },
          command.goal,
          {
            baseCell: this.#config.baseCell,
            centers: this.#centers,
            rovers: this.#rovers,
          },
        );
        if (!confirmed.ok) {
          return {
            ok: false,
            code:
              confirmed.code === 'ROUTE_GOAL_INVALID'
                ? 'ROUTE_GOAL_INVALID'
                : 'ROUTE_INVALID',
          };
        }
        rover.route = confirmed.route;
        rover.routeStepIndex = 0;
        rover.routeLegIndex = 0;
        rover.legDistance = 0;
        rover.routeTraversalIndex = 0;
        if (!preserveCurrentEntry) {
          rover.stepElapsedGameMinutes = 0;
          rover.stepDurationGameMinutes = null;
          rover.position = { ...rover.cell };
        }
        rover.status = 'MOVING';
        return { ok: true, events: [] };
      }
      case 'ROUTE_ROVER_TO': {
        if (!['RUNNING', 'PAUSED'].includes(this.#phase)) {
          return { ok: false, code: 'SHIFT_NOT_ACTIVE' };
        }
        const rover = this.#rovers.find(({ id }) => id === command.roverId);
        if (rover === undefined) return { ok: false, code: 'ROVER_NOT_FOUND' };
        if (!['IDLE_AT_BASE', 'IDLE_ON_MAP', 'MOVING'].includes(rover.status)) {
          return { ok: false, code: 'ROVER_UNAVAILABLE' };
        }

        const result = findNavigationRoute(
          rover.position,
          rover.cell,
          command.destination,
          this.#config.routingMap,
          this.#config.routeWeights,
        );
        if (!result.ok || result.legs.length === 0) {
          return { ok: false, code: 'ROUTE_INVALID' };
        }
        const route = createNavigationRoute(
          rover.cell,
          rover.position,
          command.destination,
          result,
          this.#config.routingMap,
          {
            gameMinutesPerNormalCell: rover.gameMinutesPerNormalCell,
            batteryCostMultiplier: rover.batteryCostMultiplier,
            currentBattery: rover.battery,
          },
        );

        rover.route = route;
        rover.routeStepIndex = 0;
        rover.stepElapsedGameMinutes = 0;
        rover.stepDurationGameMinutes = null;
        rover.routeLegIndex = 0;
        rover.legDistance = 0;
        rover.routeTraversalIndex = 0;
        rover.status = 'MOVING';
        return { ok: true, events: [] };
      }
    }
  }

  advance(realMilliseconds: number): readonly DomainEvent[] {
    if (this.#phase !== 'RUNNING') return [];
    addRealTime(this.#clock, realMilliseconds);
    const events: DomainEvent[] = [];
    const deltaGameMinutes = fixedStepGameMinutes(this.#config.time);

    while (
      this.#phase === 'RUNNING' &&
      canConsumeFixedStep(this.#clock, this.#config.time)
    ) {
      consumeFixedStep(this.#clock, this.#config.time);
      const currentGameMinute = gameMinutesAt(
        this.#clock.elapsedRealMilliseconds,
        this.#config.time,
      );
      const stepStartGameMinute = roundGameValue(
        currentGameMinute - deltaGameMinutes,
      );
      const operationStep = stepEmergencyOperations(
        this.#emergencyOperations,
        this.#rovers,
        deltaGameMinutes,
        stepStartGameMinute,
        this.#config.baseCell,
      );
      events.push(
        ...applyArrivalEffects(
          operationStep.events,
          this.#rovers,
          this.#centers,
          this.#config.baseCell,
          this.#config.centerRules,
        ),
      );
      for (const rover of this.#rovers) {
        const operationTime =
          operationStep.consumedGameMinutesByRoverId.get(rover.id) ?? 0;
        const availableGameMinutes = roundGameValue(
          deltaGameMinutes - operationTime,
        );
        if (availableGameMinutes <= 0) continue;
        const random = this.#incidentRandomByRoverId.get(rover.id);
        if (random === undefined)
          throw new Error(`Нет incident RNG для ${rover.id}`);
        const roverEvents = stepRover(rover, {
          deltaGameMinutes: availableGameMinutes,
          gameMinuteAtStepStart: roundGameValue(
            stepStartGameMinute + operationTime,
          ),
          baseCell: this.#config.baseCell,
          routingMap: this.#config.routingMap,
          incidentRules: this.#config.incidentRules,
          incidentProfiles: this.#incidentProfiles,
          random,
        });
        const arrivalEvents = applyArrivalEffects(
          roverEvents,
          this.#rovers,
          this.#centers,
          this.#config.baseCell,
          this.#config.centerRules,
        );
        events.push(...arrivalEvents);
        if (rover.kind === 'repair') {
          for (const event of roverEvents) {
            if (event.type !== 'ROVER_ARRIVED' || event.roverId !== rover.id) {
              continue;
            }
            events.push(
              ...beginAutomaticRoverRepairAfterArrival(
                this.#rovers,
                this.#emergencyOperations,
                rover.id,
                this.#config.rescueRules,
                event.gameMinute,
                roundGameValue(currentGameMinute - event.gameMinute),
                this.#config.baseCell,
              ),
            );
          }
        }
      }
      for (const center of this.#centers) {
        const random = this.#randomByCenterId.get(center.id);
        if (random === undefined) throw new Error(`Нет RNG для ${center.id}`);
        events.push(
          ...stepCenter(
            center,
            deltaGameMinutes,
            currentGameMinute,
            this.#config.centerRules,
            this.#config.equipmentDemand,
            random,
          ),
        );
      }

      const outcome = evaluateOutcome(
        this.#phase,
        this.#clock.elapsedRealMilliseconds,
        this.#centers,
        this.#config.time,
      );
      this.#phase = outcome.phase;
      if (outcome.event !== undefined) events.push(outcome.event);
    }
    this.#radioJournal.ingest(events);
    return events;
  }
}

export function createSimulationEngine(
  config: SimulationConfig,
): SimulationEngine {
  return new Engine(config);
}

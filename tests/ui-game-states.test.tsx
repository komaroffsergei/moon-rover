import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  CenterSnapshot,
  GameSnapshot,
  RadioMessage,
  RoverSnapshot,
} from '../src/domain';
import type { MapGameView } from '../src/game/mapGamePort';
import { Modal } from '../src/ui/components/Modal';
import { ResultDialog } from '../src/ui/components/ResultDialog';
import { RoverActions } from '../src/ui/panels/RoverActions';
import { SelectedEntityPanel } from '../src/ui/panels/SelectedEntityPanel';
import type { GameStoreState } from '../src/ui/store/gameStore';

const workingCenter: CenterSnapshot = {
  id: 'center-alpha',
  name: 'Альфа',
  cell: { column: 4, row: 3 },
  status: 'WORKING',
  resources: { oxygen: 80, food: 65, equipment: 40 },
  depletionForecastGameMinutes: 312,
  recoveryRemainingGameMinutes: null,
};

function createSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    phase: 'RUNNING',
    elapsedRealMilliseconds: 65_000,
    elapsedGameMinutes: 260,
    remainingRealMilliseconds: 415_000,
    centers: [workingCenter],
    rovers: [],
    emergencyOperations: [],
    radioMessages: [],
    ...overrides,
  };
}

function createRadioMessage(index: number): RadioMessage {
  return {
    id: `message-${index}`,
    eventCode: 'system.shift.defeat',
    category: 'SYSTEM',
    priority: 3,
    text: `Событие ${index}`,
    objectId: null,
    cell: null,
    sourceKind: 'SYSTEM',
    gameMinute: index,
  };
}

describe('mission result dialogs', () => {
  it('renders victory as an accessible success dialog with mission metrics', () => {
    const markup = renderToStaticMarkup(
      <ResultDialog
        snapshot={createSnapshot({ phase: 'VICTORY' })}
        onReplay={vi.fn()}
        onLevelSelect={vi.fn()}
      />,
    );

    expect(markup).toContain('modal-card--success');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain(
      '<h2 id="active-modal-title">Смена завершена</h2>',
    );
    expect(markup).toContain('Все действующие центры пережили рабочую смену.');
    expect(markup).toContain('<dt>Время</dt><dd>01:05</dd>');
    expect(markup).toContain('<dt>Центры</dt><dd>1/1</dd>');
    expect(markup).toContain('Выбор карты');
    expect(markup).toContain('Повторить');
    expect(markup).not.toContain('Последние события');
  });

  it('renders defeat with a named lost center and the five latest events', () => {
    const lostCenter: CenterSnapshot = {
      ...workingCenter,
      status: 'LOST',
      resources: { oxygen: 0, food: 0, equipment: 12 },
    };
    const messages = Array.from({ length: 6 }, (_, index) =>
      createRadioMessage(index + 1),
    ).reverse();
    const markup = renderToStaticMarkup(
      <ResultDialog
        snapshot={createSnapshot({
          phase: 'DEFEAT',
          centers: [lostCenter],
          radioMessages: messages,
        })}
        onReplay={vi.fn()}
        onLevelSelect={vi.fn()}
      />,
    );

    expect(markup).toContain('modal-card--danger');
    expect(markup).toContain(
      '<h2 id="active-modal-title">Миссия потеряна</h2>',
    );
    expect(markup).toContain('Потерян центр: Альфа.');
    expect(markup).toContain('<dt>Центры</dt><dd>0/1</dd>');
    expect(markup).toContain('Последние события');
    expect(markup).not.toContain('Событие 1');
    for (const eventNumber of [2, 3, 4, 5, 6]) {
      expect(markup).toContain(`Событие ${eventNumber}`);
    }
  });
});

describe('critical center presentation', () => {
  it('keeps recovery inline and communicates it with status text and timer', () => {
    const recoveryCenter: CenterSnapshot = {
      ...workingCenter,
      status: 'RECOVERY',
      resources: { oxygen: 12, food: 8, equipment: 35 },
      recoveryRemainingGameMinutes: 30,
    };
    const view: MapGameView = {
      snapshot: createSnapshot({ centers: [recoveryCenter] }),
      baseCell: { column: 1, row: 1 },
      selectedEntity: { kind: 'center', id: recoveryCenter.id },
      routingRoverId: null,
      focusRequest: null,
      centerMetrics: [
        {
          centerId: recoveryCenter.id,
          oxygenPercent: 12,
          foodPercent: 8,
          equipmentPercent: 35,
          depletionForecastGameMinutes: 0,
        },
      ],
      roverActions: [],
      routeDraft: null,
      candidateCells: [],
      forecast: null,
      canDispatchRoute: false,
    };
    const markup = renderToStaticMarkup(
      <SelectedEntityPanel
        onDismiss={vi.fn()}
        state={
          {
            view,
            commandError: null,
            focusEntity: vi.fn(),
          } as unknown as GameStoreState
        }
      />,
    );

    expect(markup).toContain('status-chip--recovery');
    expect(markup).toContain('Критично');
    expect(markup).toContain('Критическое восстановление');
    expect(markup).toContain('00:30');
    expect(markup).toMatch(
      /role="progressbar" aria-label="Кислород"[^>]*aria-valuenow="12"/,
    );
    expect(markup).toMatch(
      /role="progressbar" aria-label="Пайки"[^>]*aria-valuenow="8"/,
    );
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain('aria-modal="true"');
  });

  it('names equipment when equipment depletion caused recovery', () => {
    const recoveryCenter: CenterSnapshot = {
      ...workingCenter,
      status: 'RECOVERY',
      resources: { oxygen: 12, food: 8, equipment: 0 },
      recoveryRemainingGameMinutes: 30,
    };
    const view: MapGameView = {
      snapshot: createSnapshot({ centers: [recoveryCenter] }),
      baseCell: { column: 1, row: 1 },
      selectedEntity: { kind: 'center', id: recoveryCenter.id },
      routingRoverId: null,
      focusRequest: null,
      centerMetrics: [
        {
          centerId: recoveryCenter.id,
          oxygenPercent: 12,
          foodPercent: 8,
          equipmentPercent: 0,
          depletionForecastGameMinutes: 0,
        },
      ],
      roverActions: [],
      routeDraft: null,
      candidateCells: [],
      forecast: null,
      canDispatchRoute: false,
    };
    const markup = renderToStaticMarkup(
      <SelectedEntityPanel
        onDismiss={vi.fn()}
        state={
          {
            view,
            commandError: null,
            focusEntity: vi.fn(),
          } as unknown as GameStoreState
        }
      />,
    );

    expect(markup).toContain('Срочно доставьте оборудование');
    expect(markup).not.toContain('Выбрать ровер');
  });

  it('renders no permanent selected-object chrome without selection or error', () => {
    const view: MapGameView = {
      snapshot: createSnapshot(),
      baseCell: { column: 1, row: 1 },
      selectedEntity: null,
      routingRoverId: null,
      focusRequest: null,
      centerMetrics: [],
      roverActions: [],
      routeDraft: null,
      candidateCells: [],
      forecast: null,
      canDispatchRoute: false,
    };
    const markup = renderToStaticMarkup(
      <SelectedEntityPanel
        onDismiss={vi.fn()}
        state={
          {
            view,
            commandError: null,
          } as unknown as GameStoreState
        }
      />,
    );

    expect(markup).toBe('');
  });
});

describe('active route presentation', () => {
  it('shows edge progress and a capacity-normalized finish battery forecast', () => {
    const rover: RoverSnapshot = {
      id: 'heavy-one',
      name: 'Тяжёлый',
      archetypeId: 'heavy',
      kind: 'courier',
      status: 'MOVING',
      cell: { column: 0, row: 0 },
      position: { column: 0.2, row: 0 },
      cargo: { oxygen: 20, food: 20, equipment: 20 },
      cargoCapacity: 60,
      battery: 120,
      batteryCapacity: 120,
      gameMinutesPerNormalCell: 2,
      batteryCostMultiplier: 1,
      route: {
        mode: 'FREE_NAVIGATION',
        origin: { column: 0, row: 0 },
        originPosition: { column: 0, row: 0 },
        steps: [
          { column: 1, row: 0 },
          { column: 2, row: 0 },
        ],
        legs: [
          {
            from: { column: 0, row: 0 },
            to: { column: 1, row: 0 },
            distance: 1,
            traversals: [],
          },
          {
            from: { column: 1, row: 0 },
            to: { column: 2, row: 0 },
            distance: 1,
            traversals: [],
          },
        ],
        goal: { kind: 'CELL', cell: { column: 2, row: 0 } },
        forecast: {
          lengthCells: 2,
          gameMinutes: 7,
          batteryCost: 2,
          batteryRemaining: 118,
          risk: 0.1,
        },
      },
      movement: {
        from: { column: 0, row: 0 },
        to: { column: 1, row: 0 },
        progress: 0.2,
      },
      activeIncident: null,
      incidentCooldownCellsRemaining: 0,
    };
    const view: MapGameView = {
      snapshot: createSnapshot({ rovers: [rover] }),
      baseCell: { column: 0, row: 0 },
      selectedEntity: { kind: 'rover', id: rover.id },
      routingRoverId: null,
      focusRequest: null,
      centerMetrics: [],
      roverActions: [
        {
          roverId: rover.id,
          canEditCargo: false,
          canAssignRoute: true,
          canCharge: false,
          unloadCenterId: null,
          repairCommands: [],
          rescueCommands: [],
          batteryTransferPairs: [],
        },
      ],
      routeDraft: null,
      candidateCells: [],
      forecast: null,
      canDispatchRoute: false,
    };
    const markup = renderToStaticMarkup(
      <RoverActions
        rover={rover}
        state={
          {
            view,
            cargoDrafts: {},
          } as unknown as GameStoreState
        }
      />,
    );

    expect(markup).toContain('Активный маршрут');
    expect(markup).toContain('<dt>Текущий участок</dt><dd>20%</dd>');
    expect(markup).toContain('<dt>Заряд на финише</dt><dd>98%</dd>');
  });
});

describe('cargo presentation', () => {
  it('uses the shared integer formatter without mutating fractional cargo', () => {
    const rover: RoverSnapshot = {
      id: 'courier-one',
      name: 'Курьер-1',
      archetypeId: 'courier',
      kind: 'courier',
      status: 'IDLE_ON_MAP',
      cell: { column: 2, row: 2 },
      position: { column: 2, row: 2 },
      cargo: { oxygen: 0.56, food: 0.56, equipment: 0.17 },
      cargoCapacity: 7.44,
      battery: 80,
      batteryCapacity: 100,
      gameMinutesPerNormalCell: 2,
      batteryCostMultiplier: 1,
      route: null,
      movement: null,
      activeIncident: null,
      incidentCooldownCellsRemaining: 0,
    };
    const view: MapGameView = {
      snapshot: createSnapshot({ rovers: [rover] }),
      baseCell: { column: 1, row: 1 },
      selectedEntity: null,
      routingRoverId: null,
      focusRequest: null,
      centerMetrics: [],
      roverActions: [],
      routeDraft: null,
      candidateCells: [],
      forecast: null,
      canDispatchRoute: false,
    };
    const markup = renderToStaticMarkup(
      <RoverActions
        rover={rover}
        state={
          {
            view,
            cargoDrafts: {},
          } as unknown as GameStoreState
        }
      />,
    );

    expect(markup).toContain('<dt>Кислород</dt><dd>1</dd>');
    expect(markup).toContain('<dt>Пайки</dt><dd>1</dd>');
    expect(markup).toContain('<dt>Оборудование</dt><dd>0</dd>');
    expect(rover.cargo).toEqual({ oxygen: 0.56, food: 0.56, equipment: 0.17 });
  });
});

describe('allowed modal accessibility contract', () => {
  it.each(['Смена приостановлена', 'Подтвердить передачу батареи'])(
    'labels the %s modal through its visible heading',
    (title) => {
      const markup = renderToStaticMarkup(
        <Modal
          title={title}
          onDismiss={vi.fn()}
          footer={<button type="button">Продолжить</button>}
        >
          <p>Контекст подтверждения</p>
        </Modal>,
      );

      expect(markup.match(/role="dialog"/g)).toHaveLength(1);
      expect(markup).toContain('aria-modal="true"');
      expect(markup).toContain('aria-labelledby="active-modal-title"');
      expect(markup).toContain(`<h2 id="active-modal-title">${title}</h2>`);
      expect(markup).toContain('aria-label="Закрыть"');
    },
  );
});

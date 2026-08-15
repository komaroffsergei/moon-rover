import type { ReactNode } from 'react';

import type { CenterSnapshot } from '../../domain';
import type { GameCommandError, GameStoreState } from '../store/gameStore';
import {
  formatGameMinuteCountdown,
  formatPercent,
} from '../components/formatters';
import { ResourceBar } from '../components/ResourceBar';
import { RoverActions } from './RoverActions';

interface SelectedEntityPanelProps {
  readonly state: GameStoreState;
  readonly onDismiss: () => void;
}

const ERROR_LABELS: Readonly<Partial<Record<GameCommandError, string>>> = {
  INVALID_PHASE: 'Действие недоступно на этом этапе смены.',
  SHIFT_NOT_ACTIVE: 'Смена сейчас не активна.',
  ROVER_UNAVAILABLE: 'Ровер занят или находится в аварийном состоянии.',
  ROVER_OUT_OF_RANGE: 'Ровер должен находиться рядом с целью.',
  ROUTE_INVALID: 'Маршрут содержит недоступную клетку.',
  ROUTE_GOAL_INVALID: 'Завершите маршрут у базы, центра или ровера.',
  CARGO_CAPACITY_EXCEEDED: 'Превышена вместимость ровера.',
  BATTERY_TRANSFER_UNAVAILABLE: 'Передача батареи сейчас недоступна.',
  ROVER_NOT_SELECTED: 'Сначала выберите ровер.',
};

function CenterDetails({
  center,
  metrics,
  state,
}: {
  readonly center: CenterSnapshot;
  readonly metrics: GameStoreState['view']['centerMetrics'][number] | undefined;
  readonly state: GameStoreState;
}) {
  const recovery = center.recoveryRemainingGameMinutes;
  const depletedResources = [
    center.resources.oxygen <= 0 ? 'кислород' : null,
    center.resources.food <= 0 ? 'пайки' : null,
    center.resources.equipment <= 0 ? 'оборудование' : null,
  ].filter((resource): resource is string => resource !== null);

  return (
    <div className="selected-center">
      <div className="selected-panel__heading">
        <div>
          <p className="panel-kicker">Центр снабжения</p>
          <h2>{center.name}</h2>
        </div>
        <span
          className={`status-chip status-chip--${center.status.toLowerCase()}`}
        >
          {center.status === 'WORKING'
            ? 'Штатно'
            : center.status === 'WARNING'
              ? 'Внимание'
              : center.status === 'RECOVERY'
                ? 'Критично'
                : 'Потерян'}
        </span>
      </div>
      {metrics ? (
        <div className="selected-panel__resources">
          <ResourceBar
            icon="O₂"
            label="Кислород"
            value={metrics.oxygenPercent}
            tone="oxygen"
          />
          <ResourceBar
            icon="▰"
            label="Пайки"
            value={metrics.foodPercent}
            tone="food"
          />
          <ResourceBar
            icon="◇"
            label="Оборудование"
            value={metrics.equipmentPercent}
            tone="equipment"
          />
          <p className="selected-panel__forecast">
            Прогноз до истощения:{' '}
            {formatGameMinuteCountdown(metrics.depletionForecastGameMinutes)}
          </p>
        </div>
      ) : null}
      {center.status === 'RECOVERY' && recovery !== null ? (
        <div className="state-callout state-callout--critical" role="status">
          <strong>! Критическое восстановление</strong>
          <p>
            Срочно доставьте{' '}
            {depletedResources.length > 0
              ? depletedResources.join(', ')
              : 'истощённый ресурс'}{' '}
            за {formatGameMinuteCountdown(recovery)}.
          </p>
        </div>
      ) : null}
      <div className="selected-panel__actions">
        <button
          type="button"
          onClick={() => state.focusEntity({ kind: 'center', id: center.id })}
        >
          Показать центр
        </button>
      </div>
    </div>
  );
}

export function SelectedEntityPanel({
  state,
  onDismiss,
}: SelectedEntityPanelProps) {
  const selected = state.view.selectedEntity;
  let content: ReactNode = null;

  if (selected?.kind === 'center') {
    const center = state.view.snapshot.centers.find(
      ({ id }) => id === selected.id,
    );
    if (center) {
      content = (
        <CenterDetails
          center={center}
          metrics={state.view.centerMetrics.find(
            ({ centerId }) => centerId === center.id,
          )}
          state={state}
        />
      );
    }
  } else if (selected?.kind === 'rover') {
    const rover = state.view.snapshot.rovers.find(
      ({ id }) => id === selected.id,
    );
    if (rover) content = <RoverActions rover={rover} state={state} />;
  } else if (selected?.kind === 'base') {
    const atBase = state.view.snapshot.rovers.filter(
      ({ cell }) =>
        cell.column === state.view.baseCell.column &&
        cell.row === state.view.baseCell.row,
    );
    content = (
      <div className="selected-base">
        <p className="panel-kicker">Логистический узел</p>
        <h2>База</h2>
        <p>Загрузка, зарядка и отправка роверов.</p>
        <div className="selected-panel__actions">
          {atBase.map((rover) => (
            <button
              type="button"
              key={rover.id}
              onClick={() =>
                state.selectEntity({ kind: 'rover', id: rover.id })
              }
            >
              Выбрать {rover.name} ·{' '}
              {formatPercent((rover.battery / rover.batteryCapacity) * 100)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (content === null && state.commandError === null) return null;

  return (
    <section className="selected-panel" aria-label="Выбранный объект">
      <button
        className="selected-panel__dismiss"
        type="button"
        aria-label="Свернуть сведения об объекте"
        onClick={onDismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
      {state.commandError ? (
        <p className="command-error" role="alert">
          {ERROR_LABELS[state.commandError] ??
            `Команда отклонена: ${state.commandError}`}
        </p>
      ) : null}
      {content}
    </section>
  );
}
